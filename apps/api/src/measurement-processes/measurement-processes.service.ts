import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
  academicYears,
  assessmentCourseAssignments,
  assessments,
  classGroups,
  grades,
  instruments,
  measurementProcesses,
  subjects,
  taxonomies,
  withOrgContext,
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
import type { CoverageAssembly, ProcessRow } from './measurement-processes.helpers';
import {
  EMPTY_COVERAGE,
  ProcessCoverageService,
  type ProcessAssessmentStats,
} from './process-coverage.service';

@Injectable()
export class MeasurementProcessesService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly coverageService: ProcessCoverageService,
  ) {}

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
        this.coverageService.load(tx, orgId, rows),
        this.coverageService.loadAssessmentStats(
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
        this.coverageService.load(tx, orgId, [row]),
        this.coverageService.loadAssessmentStats(tx, [row.id]),
      ]);
      return this.toModel(row, coverage.get(row.id) ?? EMPTY_COVERAGE, stats.get(row.id));
    });
  }

  async coverage(user: JwtPayload, processId: string): Promise<ProcessCoverageResponse> {
    const orgId = this.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const row = await this.requireProcess(tx, orgId, processId);
      const assembly =
        (await this.coverageService.load(tx, orgId, [row])).get(row.id) ?? EMPTY_COVERAGE;
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
        this.coverageService.load(tx, orgId, [row]),
        this.coverageService.loadAssessmentStats(tx, [row.id]),
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
    stats: ProcessAssessmentStats | undefined,
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
