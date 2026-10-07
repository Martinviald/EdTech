import { Injectable, NotFoundException } from '@nestjs/common';
import { and, countDistinct, eq, inArray, isNull, sql } from 'drizzle-orm';
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
  withOrgContext,
  resolveEffectiveBandsForInstruments,
} from '@soe/db';
import {
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  expandExpectedCells,
  isExpectedScopeDefined,
  type EstablishmentBandCell,
  type EstablishmentCountRow,
  type EstablishmentGradeColumn,
  type EstablishmentSexComparisonRow,
  type EstablishmentSubjectSection,
  type ExpectedScope,
  type InstrumentApplicationPeriod,
  type MetricType,
  type OfficialEstablishmentReportQueryDto,
  type OfficialEstablishmentReportResponse,
  type PerformanceBandInput,
  type PerformanceBandView,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { hydrateBandForStudent } from '../performance-bands/lib/hydrate-band-level';
import { ReportSupportService } from './report-support.service';
import { compareSexes } from './lib/sex-comparison';

const SCOPE_NOTE_SOCIOEMOTIONAL =
  'El Área Socioemocional del informe oficial no se reproduce: la plataforma no ingesta el cuestionario socioemocional. Sólo se genera el Área Académica (Tablas 1.1–1.9).';

type ProcessRecord = {
  id: string;
  name: string;
  academicYearId: string;
  academicYear: number | null;
  period: InstrumentApplicationPeriod | null;
  expectedScope: ExpectedScope;
};

type AssignmentRow = {
  assessmentId: string;
  assessmentName: string | null;
  instrumentId: string;
  subjectId: string | null;
  subjectName: string | null;
  classGroupId: string;
  gradeId: string;
  gradeName: string;
  gradeOrder: number;
};

type ResultRow = {
  studentId: string;
  assessmentId: string;
  classGroupId: string;
  gender: string | null;
  percentage: number | null;
  metricType: MetricType;
  performanceBandId: string | null;
};

type SexTally = { female: number[]; male: number[]; f: number; m: number; other: number };

type ColumnAcc = {
  subjectId: string;
  subjectName: string;
  gradeId: string;
  gradeName: string;
  gradeOrder: number;
  assessments: Map<string, string | null>;
  instrumentIds: Set<string>;
  classGroupIds: Set<string>;
  evaluatedStudentIds: Set<string>;
  bandCounts: Map<string, number>;
  bandTotal: number;
  sex: SexTally;
};

type ClassGroupCatalog = {
  gradeByClassGroup: Map<string, string>;
  activeByClassGroup: Map<string, number>;
};

@Injectable()
export class EstablishmentReportService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly support: ReportSupportService,
  ) {}

  async getEstablishmentReport(
    user: JwtPayload,
    query: OfficialEstablishmentReportQueryDto,
  ): Promise<OfficialEstablishmentReportResponse> {
    const orgId = this.support.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const process = await this.requireProcess(tx, orgId, query.processId);
      const assignments = await this.loadAssignments(tx, orgId, process.id);
      const columns = this.buildColumns(assignments);

      const results = await this.loadResults(tx, orgId, this.assessmentIdsOf(columns));
      const singleColumnByCell = this.indexSingleColumns(columns);
      const instrumentIds = this.singleInstrumentIds(columns);
      const bandsByInstrument = await this.loadBandsByInstrument(tx, instrumentIds);
      this.accumulateResults(results, singleColumnByCell, bandsByInstrument);
      this.accumulateMultipleCoverage(results, columns);

      const catalog = await this.loadClassGroupCatalog(tx, orgId, process.expectedScope, columns);
      const { disclaimers, levelDefinitions } = await this.loadInstrumentMeta(
        tx,
        this.allInstrumentIds(columns),
      );
      const orgMeta = await this.support.loadOrgMeta(tx, orgId);
      const directorName = await this.support.loadDirectorName(tx, orgId);

      const sections = this.buildSections(
        columns,
        bandsByInstrument,
        process.expectedScope,
        catalog,
      );

      return {
        meta: {
          orgId: orgMeta.orgId,
          orgName: orgMeta.orgName,
          rbd: orgMeta.rbd,
          commune: orgMeta.commune,
          region: orgMeta.region,
          directorName,
          processId: process.id,
          processName: process.name,
          academicYearId: process.academicYearId,
          academicYear: process.academicYear,
          period: process.period,
          periodLabel: process.period ? INSTRUMENT_APPLICATION_PERIOD_LABELS[process.period] : null,
          generatedAt: new Date().toISOString(),
          disclaimers,
          variant: this.support.resolveVariant(process.period),
        },
        levelDefinitions,
        subjects: sections,
        bandsAvailable: sections.some((s) => s.grades.some((g) => g.bands !== null)),
        sexDataAvailable: sections.some((s) =>
          s.counts.some((row) => row.female > 0 || row.male > 0),
        ),
        scopeNotes: [SCOPE_NOTE_SOCIOEMOTIONAL],
      };
    });
  }

  private async requireProcess(
    tx: Database,
    orgId: string,
    processId: string,
  ): Promise<ProcessRecord> {
    const [row] = await tx
      .select({
        id: measurementProcesses.id,
        name: measurementProcesses.name,
        academicYearId: measurementProcesses.academicYearId,
        academicYear: academicYears.year,
        period: measurementProcesses.period,
        expectedScope: measurementProcesses.expectedScope,
      })
      .from(measurementProcesses)
      .leftJoin(academicYears, eq(academicYears.id, measurementProcesses.academicYearId))
      .where(
        and(
          eq(measurementProcesses.id, processId),
          eq(measurementProcesses.orgId, orgId),
          isNull(measurementProcesses.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Proceso de medición no encontrado.');
    return {
      id: row.id,
      name: row.name,
      academicYearId: row.academicYearId,
      academicYear: row.academicYear ?? null,
      period: row.period ?? null,
      expectedScope: row.expectedScope ?? {},
    };
  }

  private async loadAssignments(
    tx: Database,
    orgId: string,
    processId: string,
  ): Promise<AssignmentRow[]> {
    return tx
      .select({
        assessmentId: assessments.id,
        assessmentName: assessments.name,
        instrumentId: assessments.instrumentId,
        subjectId: instruments.subjectId,
        subjectName: subjects.name,
        classGroupId: classGroups.id,
        gradeId: grades.id,
        gradeName: grades.name,
        gradeOrder: grades.order,
      })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
      .innerJoin(
        assessmentCourseAssignments,
        eq(assessmentCourseAssignments.assessmentId, assessments.id),
      )
      .innerJoin(classGroups, eq(classGroups.id, assessmentCourseAssignments.classGroupId))
      .innerJoin(grades, eq(grades.id, classGroups.gradeId))
      .where(
        and(
          eq(assessments.orgId, orgId),
          eq(assessments.processId, processId),
          isNull(instruments.deletedAt),
        ),
      );
  }

  private buildColumns(assignments: AssignmentRow[]): Map<string, ColumnAcc> {
    const columns = new Map<string, ColumnAcc>();
    for (const row of assignments) {
      if (!row.subjectId || !row.subjectName) continue;
      const key = this.columnKey(row.subjectId, row.gradeId);
      let column = columns.get(key);
      if (!column) {
        column = {
          subjectId: row.subjectId,
          subjectName: row.subjectName,
          gradeId: row.gradeId,
          gradeName: row.gradeName,
          gradeOrder: row.gradeOrder,
          assessments: new Map(),
          instrumentIds: new Set(),
          classGroupIds: new Set(),
          evaluatedStudentIds: new Set(),
          bandCounts: new Map(),
          bandTotal: 0,
          sex: { female: [], male: [], f: 0, m: 0, other: 0 },
        };
        columns.set(key, column);
      }
      column.assessments.set(row.assessmentId, row.assessmentName);
      column.instrumentIds.add(row.instrumentId);
      column.classGroupIds.add(row.classGroupId);
    }
    return columns;
  }

  private columnKey(subjectId: string, gradeId: string): string {
    return `${subjectId}|${gradeId}`;
  }

  private cellKey(assessmentId: string, classGroupId: string): string {
    return `${assessmentId}|${classGroupId}`;
  }

  private isMultiple(column: ColumnAcc): boolean {
    return column.assessments.size > 1;
  }

  private assessmentIdsOf(columns: Map<string, ColumnAcc>): string[] {
    const ids = new Set<string>();
    for (const column of columns.values()) {
      for (const id of column.assessments.keys()) ids.add(id);
    }
    return Array.from(ids);
  }

  private singleInstrumentIds(columns: Map<string, ColumnAcc>): string[] {
    const ids = new Set<string>();
    for (const column of columns.values()) {
      if (this.isMultiple(column)) continue;
      for (const id of column.instrumentIds) ids.add(id);
    }
    return Array.from(ids);
  }

  private allInstrumentIds(columns: Map<string, ColumnAcc>): string[] {
    const ids = new Set<string>();
    for (const column of columns.values()) {
      for (const id of column.instrumentIds) ids.add(id);
    }
    return Array.from(ids);
  }

  private indexSingleColumns(columns: Map<string, ColumnAcc>): Map<string, ColumnAcc> {
    const byCell = new Map<string, ColumnAcc>();
    for (const column of columns.values()) {
      if (this.isMultiple(column)) continue;
      const [assessmentId] = column.assessments.keys();
      if (!assessmentId) continue;
      for (const classGroupId of column.classGroupIds) {
        byCell.set(this.cellKey(assessmentId, classGroupId), column);
      }
    }
    return byCell;
  }

  private async loadResults(
    tx: Database,
    orgId: string,
    assessmentIds: string[],
  ): Promise<ResultRow[]> {
    if (assessmentIds.length === 0) return [];
    const rows = await tx
      .select({
        studentId: assessmentResults.studentId,
        assessmentId: assessmentResults.assessmentId,
        classGroupId: studentEnrollments.classGroupId,
        gender: sql<string | null>`${students.gender}::text`,
        percentage: assessmentResults.percentage,
        metricType: assessmentResults.metricType,
        performanceBandId: assessmentResults.performanceBandId,
      })
      .from(assessmentResults)
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .innerJoin(studentEnrollments, eq(studentEnrollments.studentId, assessmentResults.studentId))
      .innerJoin(
        assessmentCourseAssignments,
        and(
          eq(assessmentCourseAssignments.assessmentId, assessmentResults.assessmentId),
          eq(assessmentCourseAssignments.classGroupId, studentEnrollments.classGroupId),
        ),
      )
      .where(
        and(
          inArray(assessmentResults.assessmentId, assessmentIds),
          eq(students.orgId, orgId),
          isNull(students.deletedAt),
        ),
      );
    return rows.map((r) => ({
      studentId: r.studentId,
      assessmentId: r.assessmentId,
      classGroupId: r.classGroupId,
      gender: r.gender,
      percentage: r.percentage === null ? null : Number(r.percentage),
      metricType: r.metricType,
      performanceBandId: r.performanceBandId ?? null,
    }));
  }

  private async loadBandsByInstrument(
    tx: Database,
    instrumentIds: string[],
  ): Promise<Map<string, PerformanceBandInput[]>> {
    const bandsByInstrument = new Map<string, PerformanceBandInput[]>();
    if (instrumentIds.length === 0) return bandsByInstrument;
    const effective = await resolveEffectiveBandsForInstruments(tx, instrumentIds);
    for (const [instrumentId, { bands }] of effective) {
      if (bands.length > 0) bandsByInstrument.set(instrumentId, bands);
    }
    return bandsByInstrument;
  }

  private accumulateResults(
    results: ResultRow[],
    singleColumnByCell: Map<string, ColumnAcc>,
    bandsByInstrument: Map<string, PerformanceBandInput[]>,
  ): void {
    for (const row of results) {
      const column = singleColumnByCell.get(this.cellKey(row.assessmentId, row.classGroupId));
      if (!column || column.evaluatedStudentIds.has(row.studentId)) continue;
      column.evaluatedStudentIds.add(row.studentId);

      const bands = this.columnBands(column, bandsByInstrument);
      if (bands) {
        const band = hydrateBandForStudent(
          {
            metricType: row.metricType,
            percentage: row.percentage,
            performanceLevel: null,
            performanceBandId: row.performanceBandId,
          },
          bands,
        ).band;
        if (band) {
          column.bandCounts.set(band.key, (column.bandCounts.get(band.key) ?? 0) + 1);
          column.bandTotal += 1;
        }
      }

      if (row.gender === 'F') {
        column.sex.f += 1;
        if (row.percentage !== null) column.sex.female.push(row.percentage);
      } else if (row.gender === 'M') {
        column.sex.m += 1;
        if (row.percentage !== null) column.sex.male.push(row.percentage);
      } else {
        column.sex.other += 1;
      }
    }
  }

  private accumulateMultipleCoverage(results: ResultRow[], columns: Map<string, ColumnAcc>): void {
    const multipleByCell = new Map<string, ColumnAcc>();
    for (const column of columns.values()) {
      if (!this.isMultiple(column)) continue;
      for (const assessmentId of column.assessments.keys()) {
        for (const classGroupId of column.classGroupIds) {
          multipleByCell.set(this.cellKey(assessmentId, classGroupId), column);
        }
      }
    }
    if (multipleByCell.size === 0) return;
    for (const row of results) {
      multipleByCell
        .get(this.cellKey(row.assessmentId, row.classGroupId))
        ?.evaluatedStudentIds.add(row.studentId);
    }
  }

  private columnBands(
    column: ColumnAcc,
    bandsByInstrument: Map<string, PerformanceBandInput[]>,
  ): PerformanceBandInput[] | null {
    if (this.isMultiple(column)) return null;
    const [instrumentId] = column.instrumentIds;
    if (!instrumentId) return null;
    return bandsByInstrument.get(instrumentId) ?? null;
  }

  private async loadClassGroupCatalog(
    tx: Database,
    orgId: string,
    scope: ExpectedScope,
    columns: Map<string, ColumnAcc>,
  ): Promise<ClassGroupCatalog> {
    const catalog: ClassGroupCatalog = {
      gradeByClassGroup: new Map(),
      activeByClassGroup: new Map(),
    };
    const classGroupIds = new Set<string>(scope.classGroupIds ?? []);
    for (const column of columns.values()) {
      for (const id of column.classGroupIds) classGroupIds.add(id);
    }
    if (classGroupIds.size === 0) return catalog;
    const ids = Array.from(classGroupIds);

    const groupRows = await tx
      .select({ id: classGroups.id, gradeId: classGroups.gradeId })
      .from(classGroups)
      .where(and(eq(classGroups.orgId, orgId), inArray(classGroups.id, ids)));
    for (const row of groupRows) catalog.gradeByClassGroup.set(row.id, row.gradeId);

    const enrollmentRows = await tx
      .select({
        classGroupId: studentEnrollments.classGroupId,
        total: countDistinct(studentEnrollments.studentId),
      })
      .from(studentEnrollments)
      .innerJoin(students, eq(students.id, studentEnrollments.studentId))
      .where(
        and(
          inArray(studentEnrollments.classGroupId, ids),
          eq(studentEnrollments.status, 'active'),
          eq(students.orgId, orgId),
          isNull(students.deletedAt),
        ),
      )
      .groupBy(studentEnrollments.classGroupId);
    for (const row of enrollmentRows) {
      catalog.activeByClassGroup.set(row.classGroupId, Number(row.total));
    }
    return catalog;
  }

  private scopeClassGroupsByColumn(
    scope: ExpectedScope,
    catalog: ClassGroupCatalog,
  ): Map<string, Set<string>> {
    const byColumn = new Map<string, Set<string>>();
    if (!isExpectedScopeDefined(scope)) return byColumn;
    for (const cell of expandExpectedCells(scope)) {
      const gradeId = catalog.gradeByClassGroup.get(cell.classGroupId);
      if (!gradeId) continue;
      const key = this.columnKey(cell.subjectId, gradeId);
      let bucket = byColumn.get(key);
      if (!bucket) {
        bucket = new Set();
        byColumn.set(key, bucket);
      }
      bucket.add(cell.classGroupId);
    }
    return byColumn;
  }

  private expectedFor(
    column: ColumnAcc,
    scopeClassGroups: Set<string> | undefined,
    catalog: ClassGroupCatalog,
  ): number | null {
    const classGroupIds = scopeClassGroups ?? column.classGroupIds;
    let expected = 0;
    let known = false;
    for (const classGroupId of classGroupIds) {
      const active = catalog.activeByClassGroup.get(classGroupId);
      if (active === undefined) continue;
      expected += active;
      known = true;
    }
    return known ? expected : null;
  }

  private buildSections(
    columns: Map<string, ColumnAcc>,
    bandsByInstrument: Map<string, PerformanceBandInput[]>,
    scope: ExpectedScope,
    catalog: ClassGroupCatalog,
  ): EstablishmentSubjectSection[] {
    const scopeByColumn = this.scopeClassGroupsByColumn(scope, catalog);
    const bySubject = new Map<string, ColumnAcc[]>();
    for (const column of columns.values()) {
      let bucket = bySubject.get(column.subjectId);
      if (!bucket) {
        bucket = [];
        bySubject.set(column.subjectId, bucket);
      }
      bucket.push(column);
    }

    const sections: EstablishmentSubjectSection[] = [];
    for (const subjectColumns of bySubject.values()) {
      subjectColumns.sort((a, b) => a.gradeOrder - b.gradeOrder);
      const grades: EstablishmentGradeColumn[] = [];
      const bandDistribution: EstablishmentBandCell[] = [];
      const sexComparison: EstablishmentSexComparisonRow[] = [];
      const counts: EstablishmentCountRow[] = [];

      for (const column of subjectColumns) {
        const multiple = this.isMultiple(column);
        const bands = this.columnBands(column, bandsByInstrument);
        const bandViews = bands ? this.toBandViews(bands) : null;
        const [instrumentId] = column.instrumentIds;
        const assessmentEntries = Array.from(column.assessments, ([id, name]) => ({ id, name }));

        grades.push({
          gradeId: column.gradeId,
          gradeName: column.gradeName,
          gradeOrder: column.gradeOrder,
          instrumentId: multiple ? null : (instrumentId ?? null),
          assessmentIds: assessmentEntries.map((a) => a.id),
          assessments: assessmentEntries,
          multipleAssessments: multiple,
          bandsMissing: !multiple && bandViews === null,
          bands: bandViews,
          coverage: {
            evaluated: column.evaluatedStudentIds.size,
            expected: this.expectedFor(
              column,
              scopeByColumn.get(this.columnKey(column.subjectId, column.gradeId)),
              catalog,
            ),
          },
        });

        if (multiple) continue;

        if (bandViews && column.bandTotal > 0) {
          for (const band of bandViews) {
            const count = column.bandCounts.get(band.key) ?? 0;
            bandDistribution.push({
              gradeId: column.gradeId,
              bandKey: band.key,
              count,
              total: column.bandTotal,
              percentage: (count / column.bandTotal) * 100,
            });
          }
        }

        const outcome = compareSexes(column.sex.female, column.sex.male);
        sexComparison.push({
          gradeId: column.gradeId,
          gradeName: column.gradeName,
          gradeOrder: column.gradeOrder,
          result: outcome.result,
          femaleAvg: outcome.femaleAvg,
          maleAvg: outcome.maleAvg,
          femaleN: outcome.femaleN,
          maleN: outcome.maleN,
        });

        counts.push({
          gradeId: column.gradeId,
          gradeName: column.gradeName,
          gradeOrder: column.gradeOrder,
          female: column.sex.f,
          male: column.sex.m,
          other: column.sex.other,
          total: column.sex.f + column.sex.m + column.sex.other,
        });
      }

      const [first] = subjectColumns;
      if (!first) continue;
      sections.push({
        subjectId: first.subjectId,
        subjectName: first.subjectName,
        grades,
        bands: this.resolveSharedBands(grades),
        bandDistribution,
        sexComparison,
        counts,
      });
    }

    return sections.sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'es'));
  }

  private toBandViews(bands: PerformanceBandInput[]): PerformanceBandView[] {
    return [...bands]
      .sort((a, b) => a.order - b.order)
      .map((b) => ({ key: b.key, label: b.label, order: b.order, color: b.color ?? null }));
  }

  private resolveSharedBands(grades: EstablishmentGradeColumn[]): PerformanceBandView[] | null {
    let reference: PerformanceBandView[] | null = null;
    let referenceSignature: string | null = null;
    for (const grade of grades) {
      if (!grade.bands) continue;
      const signature = grade.bands.map((b) => b.key).join('|');
      if (referenceSignature === null) {
        reference = grade.bands;
        referenceSignature = signature;
      } else if (signature !== referenceSignature) {
        return null;
      }
    }
    return reference;
  }

  private async loadInstrumentMeta(
    tx: Database,
    instrumentIds: string[],
  ): Promise<{ disclaimers: string[]; levelDefinitions: string[] }> {
    if (instrumentIds.length === 0) return { disclaimers: [], levelDefinitions: [] };
    const rows = await tx
      .select({ config: instruments.config })
      .from(instruments)
      .where(inArray(instruments.id, instrumentIds));

    const disclaimers = new Set<string>();
    const levelDefinitions = new Set<string>();
    for (const r of rows) {
      const config = (r.config ?? {}) as Record<string, unknown>;
      this.collectStrings(config.reportDisclaimers, disclaimers);
      this.collectStrings(config.levelDefinitions, levelDefinitions);
    }
    return {
      disclaimers: Array.from(disclaimers),
      levelDefinitions: Array.from(levelDefinitions),
    };
  }

  private collectStrings(raw: unknown, into: Set<string>): void {
    if (!Array.isArray(raw)) return;
    for (const s of raw) if (typeof s === 'string') into.add(s);
  }
}
