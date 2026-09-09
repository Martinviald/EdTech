import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, countDistinct, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
  academicYears,
  assessmentCourseAssignments,
  assessmentResults,
  assessments,
  classGroups,
  grades,
  instruments,
  measurementProcesses,
  studentEnrollments,
  students,
  subjects,
  taxonomies,
  withOrgContext,
  type MeasurementProcess,
} from '@soe/db';
import {
  isExpectedScopeDefined,
  slugify,
  uniqueSlug,
  type CreateMeasurementProcessDto,
  type ExpectedScope,
  type LinkProcessAssessmentsDto,
  type MeasurementProcessListQuery,
  type MeasurementProcessListResponse,
  type MeasurementProcessModel,
  type ProcessCandidatesResponse,
  type ProcessCoverageResponse,
  type UpdateMeasurementProcessDto,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import {
  assembleCoverage,
  type CoverageAssembly,
  type CoverageAssessmentCell,
  type CoverageCatalog,
} from './measurement-processes.helpers';

type ProcessRow = MeasurementProcess & { academicYear: number | null; taxonomyName: string | null };

const EMPTY_COVERAGE: CoverageAssembly = {
  totals: { expected: 0, missing: 0, scheduled: 0, partial: 0, complete: 0 },
  cells: [],
  unexpectedCells: [],
};

@Injectable()
export class MeasurementProcessesService {
  constructor(@InjectDb() private readonly db: Database) {}

  async list(
    user: JwtPayload,
    query: MeasurementProcessListQuery,
  ): Promise<MeasurementProcessListResponse> {
    const orgId = this.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const conditions = [
        eq(measurementProcesses.orgId, orgId),
        isNull(measurementProcesses.deletedAt),
      ];
      if (query.academicYearId) {
        conditions.push(eq(measurementProcesses.academicYearId, query.academicYearId));
      }
      if (query.kind) conditions.push(eq(measurementProcesses.kind, query.kind));
      if (query.status) conditions.push(eq(measurementProcesses.status, query.status));

      const [{ total }] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(measurementProcesses)
        .where(and(...conditions));

      const rows = await this.selectProcesses(tx, and(...conditions), {
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      });

      const [coverageByProcess, statsByProcess] = await Promise.all([
        this.loadCoverage(tx, orgId, rows),
        this.loadAssessmentStats(
          tx,
          rows.map((r) => r.id),
        ),
      ]);

      return {
        data: rows.map((row) =>
          this.toModel(
            row,
            coverageByProcess.get(row.id) ?? EMPTY_COVERAGE,
            statsByProcess.get(row.id),
          ),
        ),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  async detail(user: JwtPayload, processId: string): Promise<MeasurementProcessModel> {
    const orgId = this.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const row = await this.requireProcess(tx, orgId, processId);
      const [coverage, stats] = await Promise.all([
        this.loadCoverage(tx, orgId, [row]),
        this.loadAssessmentStats(tx, [row.id]),
      ]);
      return this.toModel(row, coverage.get(row.id) ?? EMPTY_COVERAGE, stats.get(row.id));
    });
  }

  async coverage(user: JwtPayload, processId: string): Promise<ProcessCoverageResponse> {
    const orgId = this.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const row = await this.requireProcess(tx, orgId, processId);
      const assembly = (await this.loadCoverage(tx, orgId, [row])).get(row.id) ?? EMPTY_COVERAGE;
      return {
        processId: row.id,
        scopeDefined: isExpectedScopeDefined(row.expectedScope),
        scopeDerived: row.expectedScope?.derived === true,
        totals: assembly.totals,
        cells: assembly.cells,
        unexpectedCells: assembly.unexpectedCells,
      };
    });
  }

  async create(
    user: JwtPayload,
    dto: CreateMeasurementProcessDto,
  ): Promise<MeasurementProcessModel> {
    const orgId = this.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const [year] = await tx
        .select({ id: academicYears.id })
        .from(academicYears)
        .where(and(eq(academicYears.id, dto.academicYearId), eq(academicYears.orgId, orgId)))
        .limit(1);
      if (!year) throw new NotFoundException('El año académico no existe en esta organización.');

      const slug = await this.buildUniqueSlug(tx, orgId, dto.name);
      const [inserted] = await tx
        .insert(measurementProcesses)
        .values({
          orgId,
          academicYearId: dto.academicYearId,
          name: dto.name,
          slug,
          kind: dto.kind,
          period: dto.period ?? null,
          taxonomyId: dto.taxonomyId ?? null,
          status: dto.status ?? 'planned',
          startsOn: dto.startsOn ?? null,
          endsOn: dto.endsOn ?? null,
          expectedScope: dto.expectedScope ?? {},
          ownerId: user.userId,
          notes: dto.notes ?? null,
        })
        .returning({ id: measurementProcesses.id });

      const row = await this.requireProcess(tx, orgId, inserted.id);
      return this.toModel(row, EMPTY_COVERAGE, undefined);
    });
  }

  async update(
    user: JwtPayload,
    processId: string,
    dto: UpdateMeasurementProcessDto,
  ): Promise<MeasurementProcessModel> {
    const orgId = this.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const current = await this.requireProcess(tx, orgId, processId);

      const changes: Partial<typeof measurementProcesses.$inferInsert> = { updatedAt: new Date() };
      if (dto.name !== undefined && dto.name !== current.name) {
        changes.name = dto.name;
        changes.slug = await this.buildUniqueSlug(tx, orgId, dto.name, processId);
      }
      if (dto.kind !== undefined) changes.kind = dto.kind;
      if (dto.period !== undefined) changes.period = dto.period ?? null;
      if (dto.taxonomyId !== undefined) changes.taxonomyId = dto.taxonomyId ?? null;
      if (dto.status !== undefined) changes.status = dto.status;
      if (dto.startsOn !== undefined) changes.startsOn = dto.startsOn ?? null;
      if (dto.endsOn !== undefined) changes.endsOn = dto.endsOn ?? null;
      if (dto.notes !== undefined) changes.notes = dto.notes ?? null;
      if (dto.expectedScope !== undefined) changes.expectedScope = dto.expectedScope;

      await tx
        .update(measurementProcesses)
        .set(changes)
        .where(and(eq(measurementProcesses.id, processId), eq(measurementProcesses.orgId, orgId)));

      const row = await this.requireProcess(tx, orgId, processId);
      const [coverage, stats] = await Promise.all([
        this.loadCoverage(tx, orgId, [row]),
        this.loadAssessmentStats(tx, [row.id]),
      ]);
      return this.toModel(row, coverage.get(row.id) ?? EMPTY_COVERAGE, stats.get(row.id));
    });
  }

  async remove(user: JwtPayload, processId: string): Promise<{ id: string; unlinked: number }> {
    const orgId = this.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      await this.requireProcess(tx, orgId, processId);

      const unlinked = await tx
        .update(assessments)
        .set({ processId: null, updatedAt: new Date() })
        .where(and(eq(assessments.processId, processId), eq(assessments.orgId, orgId)))
        .returning({ id: assessments.id });

      await tx
        .update(measurementProcesses)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(measurementProcesses.id, processId), eq(measurementProcesses.orgId, orgId)));

      return { id: processId, unlinked: unlinked.length };
    });
  }

  async linkAssessments(
    user: JwtPayload,
    processId: string,
    dto: LinkProcessAssessmentsDto,
  ): Promise<{ processId: string; linked: number; unlinked: number }> {
    const orgId = this.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      await this.requireProcess(tx, orgId, processId);

      if (dto.action === 'unlink') {
        const rows = await tx
          .update(assessments)
          .set({ processId: null, updatedAt: new Date() })
          .where(
            and(
              eq(assessments.orgId, orgId),
              eq(assessments.processId, processId),
              inArray(assessments.id, dto.assessmentIds),
            ),
          )
          .returning({ id: assessments.id });
        return { processId, linked: 0, unlinked: rows.length };
      }

      const rows = await tx
        .update(assessments)
        .set({ processId, updatedAt: new Date() })
        .where(and(eq(assessments.orgId, orgId), inArray(assessments.id, dto.assessmentIds)))
        .returning({ id: assessments.id });

      if (rows.length !== dto.assessmentIds.length) {
        throw new NotFoundException(
          'Alguna de las evaluaciones no existe en esta organización o no es accesible.',
        );
      }

      return { processId, linked: rows.length, unlinked: 0 };
    });
  }

  async candidates(user: JwtPayload, processId: string): Promise<ProcessCandidatesResponse> {
    const orgId = this.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const process = await this.requireProcess(tx, orgId, processId);

      const rows = await tx
        .select({
          assessmentId: assessments.id,
          assessmentName: assessments.name,
          administeredAt: assessments.administeredAt,
          currentProcessId: assessments.processId,
          instrumentId: instruments.id,
          instrumentName: instruments.name,
          instrumentType: instruments.type,
          applicationPeriod: instruments.applicationPeriod,
          subjectId: instruments.subjectId,
          subjectName: subjects.name,
          classGroupName: classGroups.name,
          gradeShortName: grades.shortName,
        })
        .from(assessments)
        .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
        .innerJoin(
          assessmentCourseAssignments,
          eq(assessmentCourseAssignments.assessmentId, assessments.id),
        )
        .innerJoin(classGroups, eq(classGroups.id, assessmentCourseAssignments.classGroupId))
        .innerJoin(grades, eq(grades.id, classGroups.gradeId))
        .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
        .where(
          and(
            eq(assessments.orgId, orgId),
            or(isNull(assessments.processId), ne(assessments.processId, processId)),
            isNull(instruments.deletedAt),
            eq(classGroups.academicYearId, process.academicYearId),
          ),
        )
        .orderBy(desc(assessments.administeredAt));

      const byAssessment = new Map<string, ProcessCandidatesResponse['data'][number]>();
      for (const row of rows) {
        let candidate = byAssessment.get(row.assessmentId);
        if (!candidate) {
          candidate = {
            assessmentId: row.assessmentId,
            assessmentName: row.assessmentName,
            instrumentId: row.instrumentId,
            instrumentName: row.instrumentName,
            instrumentType: row.instrumentType,
            applicationPeriod: row.applicationPeriod,
            subjectId: row.subjectId,
            subjectName: row.subjectName,
            administeredAt: row.administeredAt ? row.administeredAt.toISOString() : null,
            classGroupNames: [],
            currentProcessId: row.currentProcessId,
          };
          byAssessment.set(row.assessmentId, candidate);
        }
        candidate.classGroupNames.push(`${row.gradeShortName} ${row.classGroupName}`.trim());
      }

      const data = Array.from(byAssessment.values());
      return { data, total: data.length };
    });
  }

  private requireOrgId(user: JwtPayload): string {
    if (!user.orgId) throw new ForbiddenException('Sin organización activa');
    return user.orgId;
  }

  private async selectProcesses(
    tx: Database,
    where: ReturnType<typeof and>,
    pagination?: { limit: number; offset: number },
  ): Promise<ProcessRow[]> {
    const query = tx
      .select({
        process: measurementProcesses,
        academicYear: academicYears.year,
        taxonomyName: taxonomies.name,
      })
      .from(measurementProcesses)
      .leftJoin(academicYears, eq(academicYears.id, measurementProcesses.academicYearId))
      .leftJoin(taxonomies, eq(taxonomies.id, measurementProcesses.taxonomyId))
      .where(where)
      .orderBy(desc(academicYears.year), asc(measurementProcesses.name));

    const rows = pagination
      ? await query.limit(pagination.limit).offset(pagination.offset)
      : await query;

    return rows.map((row) => ({
      ...row.process,
      academicYear: row.academicYear,
      taxonomyName: row.taxonomyName,
    }));
  }

  private async requireProcess(
    tx: Database,
    orgId: string,
    processId: string,
  ): Promise<ProcessRow> {
    const [row] = await this.selectProcesses(
      tx,
      and(
        eq(measurementProcesses.id, processId),
        eq(measurementProcesses.orgId, orgId),
        isNull(measurementProcesses.deletedAt),
      ),
    );
    if (!row) throw new NotFoundException('El proceso de medición no existe.');
    return row;
  }

  private async loadAssessmentStats(
    tx: Database,
    processIds: readonly string[],
  ): Promise<Map<string, { assessmentCount: number; studentsAssessed: number }>> {
    const stats = new Map<string, { assessmentCount: number; studentsAssessed: number }>();
    if (processIds.length === 0) return stats;

    const counts = await tx
      .select({
        processId: assessments.processId,
        assessmentCount: sql<number>`count(*)::int`,
      })
      .from(assessments)
      .where(inArray(assessments.processId, [...processIds]))
      .groupBy(assessments.processId);

    for (const row of counts) {
      if (!row.processId) continue;
      stats.set(row.processId, { assessmentCount: row.assessmentCount, studentsAssessed: 0 });
    }

    const studentCounts = await tx
      .select({
        processId: assessments.processId,
        studentsAssessed: countDistinct(assessmentResults.studentId),
      })
      .from(assessmentResults)
      .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId))
      .where(inArray(assessments.processId, [...processIds]))
      .groupBy(assessments.processId);

    for (const row of studentCounts) {
      if (!row.processId) continue;
      const entry = stats.get(row.processId);
      if (entry) entry.studentsAssessed = Number(row.studentsAssessed);
    }

    return stats;
  }

  private async loadCoverage(
    tx: Database,
    orgId: string,
    processRows: readonly ProcessRow[],
  ): Promise<Map<string, CoverageAssembly>> {
    const result = new Map<string, CoverageAssembly>();
    if (processRows.length === 0) return result;

    const processIds = processRows.map((p) => p.id);

    const cellRows = await tx
      .select({
        processId: assessments.processId,
        assessmentId: assessments.id,
        assessmentName: assessments.name,
        classGroupId: classGroups.id,
        classGroupName: classGroups.name,
        gradeShortName: grades.shortName,
        gradeOrder: grades.order,
        subjectId: instruments.subjectId,
        subjectName: subjects.name,
        subjectShortName: subjects.shortName,
      })
      .from(assessments)
      .innerJoin(
        assessmentCourseAssignments,
        eq(assessmentCourseAssignments.assessmentId, assessments.id),
      )
      .innerJoin(classGroups, eq(classGroups.id, assessmentCourseAssignments.classGroupId))
      .innerJoin(grades, eq(grades.id, classGroups.gradeId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
      .where(and(eq(assessments.orgId, orgId), inArray(assessments.processId, processIds)));

    const assessmentIds = Array.from(new Set(cellRows.map((r) => r.assessmentId)));
    const resultCounts = assessmentIds.length
      ? await tx
          .select({
            assessmentId: assessmentResults.assessmentId,
            classGroupId: studentEnrollments.classGroupId,
            studentsWithResults: countDistinct(assessmentResults.studentId),
          })
          .from(assessmentResults)
          .innerJoin(
            studentEnrollments,
            eq(studentEnrollments.studentId, assessmentResults.studentId),
          )
          .innerJoin(students, eq(students.id, assessmentResults.studentId))
          .where(
            and(inArray(assessmentResults.assessmentId, assessmentIds), isNull(students.deletedAt)),
          )
          .groupBy(assessmentResults.assessmentId, studentEnrollments.classGroupId)
      : [];

    const resultsByCell = new Map<string, number>();
    for (const row of resultCounts) {
      resultsByCell.set(`${row.assessmentId}:${row.classGroupId}`, Number(row.studentsWithResults));
    }

    const scopeClassGroupIds = new Set<string>();
    const scopeSubjectIds = new Set<string>();
    for (const process of processRows) {
      for (const id of process.expectedScope?.classGroupIds ?? []) scopeClassGroupIds.add(id);
      for (const id of process.expectedScope?.subjectIds ?? []) scopeSubjectIds.add(id);
    }
    for (const row of cellRows) scopeClassGroupIds.add(row.classGroupId);

    const catalog = await this.loadCatalog(
      tx,
      orgId,
      Array.from(scopeClassGroupIds),
      Array.from(scopeSubjectIds),
    );

    const cellsByProcess = new Map<string, CoverageAssessmentCell[]>();
    for (const row of cellRows) {
      if (!row.processId) continue;
      let bucket = cellsByProcess.get(row.processId);
      if (!bucket) {
        bucket = [];
        cellsByProcess.set(row.processId, bucket);
      }
      bucket.push({
        assessmentId: row.assessmentId,
        assessmentName: row.assessmentName,
        classGroupId: row.classGroupId,
        classGroupName: row.classGroupName,
        gradeShortName: row.gradeShortName,
        gradeOrder: row.gradeOrder,
        subjectId: row.subjectId,
        subjectName: row.subjectName,
        subjectShortName: row.subjectShortName,
        studentsWithResults: resultsByCell.get(`${row.assessmentId}:${row.classGroupId}`) ?? 0,
      });
    }

    for (const process of processRows) {
      result.set(
        process.id,
        assembleCoverage(process.expectedScope, cellsByProcess.get(process.id) ?? [], catalog),
      );
    }

    return result;
  }

  private async loadCatalog(
    tx: Database,
    orgId: string,
    classGroupIds: readonly string[],
    subjectIds: readonly string[],
  ): Promise<CoverageCatalog> {
    const catalog: CoverageCatalog = {
      classGroups: new Map(),
      subjects: new Map(),
      studentsByClassGroup: new Map(),
    };

    if (classGroupIds.length > 0) {
      const rows = await tx
        .select({
          id: classGroups.id,
          name: classGroups.name,
          gradeShortName: grades.shortName,
          gradeOrder: grades.order,
        })
        .from(classGroups)
        .innerJoin(grades, eq(grades.id, classGroups.gradeId))
        .where(and(eq(classGroups.orgId, orgId), inArray(classGroups.id, [...classGroupIds])));
      for (const row of rows) {
        catalog.classGroups.set(row.id, {
          name: row.name,
          gradeShortName: row.gradeShortName,
          gradeOrder: row.gradeOrder,
        });
      }

      const enrollmentCounts = await tx
        .select({
          classGroupId: studentEnrollments.classGroupId,
          total: countDistinct(studentEnrollments.studentId),
        })
        .from(studentEnrollments)
        .innerJoin(students, eq(students.id, studentEnrollments.studentId))
        .where(
          and(
            inArray(studentEnrollments.classGroupId, [...classGroupIds]),
            eq(studentEnrollments.status, 'active'),
            isNull(students.deletedAt),
          ),
        )
        .groupBy(studentEnrollments.classGroupId);
      for (const row of enrollmentCounts) {
        catalog.studentsByClassGroup.set(row.classGroupId, Number(row.total));
      }
    }

    if (subjectIds.length > 0) {
      const rows = await tx
        .select({ id: subjects.id, name: subjects.name, shortName: subjects.shortName })
        .from(subjects)
        .where(inArray(subjects.id, [...subjectIds]));
      for (const row of rows) {
        catalog.subjects.set(row.id, { name: row.name, shortName: row.shortName });
      }
    }

    return catalog;
  }

  private async buildUniqueSlug(
    tx: Database,
    orgId: string,
    name: string,
    excludeProcessId?: string,
  ): Promise<string> {
    const base = slugify(name);
    if (!base)
      throw new ConflictException('El nombre del proceso no produce un identificador válido.');

    const existing = await tx
      .select({ id: measurementProcesses.id, slug: measurementProcesses.slug })
      .from(measurementProcesses)
      .where(eq(measurementProcesses.orgId, orgId));

    const taken = new Set(
      existing.filter((row) => row.id !== excludeProcessId).map((row) => row.slug),
    );

    return uniqueSlug(base, taken);
  }

  private toModel(
    row: ProcessRow,
    coverage: CoverageAssembly,
    stats: { assessmentCount: number; studentsAssessed: number } | undefined,
  ): MeasurementProcessModel {
    const expectedScope: ExpectedScope = row.expectedScope ?? {};
    const scopeDefined = isExpectedScopeDefined(expectedScope);

    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      kind: row.kind,
      period: row.period,
      status: row.status,
      academicYearId: row.academicYearId,
      academicYear: row.academicYear,
      taxonomyId: row.taxonomyId,
      taxonomyName: row.taxonomyName,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      notes: row.notes,
      expectedScope,
      scopeDefined,
      scopeDerived: expectedScope.derived === true,
      assessmentCount: stats?.assessmentCount ?? 0,
      studentsAssessed: stats?.studentsAssessed ?? 0,
      coverage: scopeDefined ? coverage.totals : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
