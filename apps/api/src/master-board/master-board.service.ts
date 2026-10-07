import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  academicYears,
  assessmentItemStats,
  assessments,
  classGroups,
  grades,
  instruments,
  measurementProcesses,
  orgMemberships,
  resolveEffectiveBandsForInstruments,
  subjectClasses,
  subjects,
  teacherAssignments,
  users,
  withOrgContext,
  type EffectiveBands,
} from '@soe/db';
import {
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  INSTRUMENT_TYPE_LABELS,
  achievementPct,
  addTally,
  buildComparabilityMeta,
  classifyTypicalZone,
  emptyTally,
  percentileOf,
  percentileRank,
  round2,
  sampleDeltaPp,
  trackOrSubjectTestKey,
  type AchievementTally,
  type CellSample,
  type ComparabilityInstrumentRef,
  type InstrumentApplicationPeriod,
  type InstrumentType,
  type MasterBoardAcademicYear,
  type MasterBoardCell,
  type MasterBoardCourseCell,
  type MasterBoardGrade,
  type MasterBoardMatrix,
  type MasterBoardMatrixQueryDto,
  type MasterBoardSubject,
  type MasterBoardTake,
  type MasterBoardTakesQueryDto,
  type MasterBoardTakesResponse,
  type MasterBoardTeacherRef,
  type MasterBoardTest,
  type MasterBoardTestSource,
  type MetricValue,
  type ProcessKind,
  type TeacherPerformance,
  type TeacherPerformanceClass,
  type TeacherPerformanceQueryDto,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import {
  BenchmarkSamplesService,
  type ItemSetRequest,
  type ItemSetSampleResult,
} from '../benchmarking/benchmark-samples.service';
import {
  buildAssessmentScopeCondition,
  resolveClassGroupScope,
  type ClassGroupScope,
} from '../common/helpers/class-group-scope.helper';
import { InjectDb, type Database } from '../database/database.types';
import {
  LEGACY_PERFORMANCE_BANDS,
  addToCellAggregate,
  availableMetrics,
  computeMetrics,
  emptyCellAggregate,
  resolvePrimaryMetricKey,
  type CellAggregate,
  type MetricContext,
} from './master-board.metrics';
import {
  loadMatrixItemTallies,
  loadMatrixRows,
  type MatrixRow,
  type MatrixRowsFilter,
} from './queries/matrix-rows.query';
import {
  loadLegacyTakeRows,
  loadProcessLinkSummaries,
  loadProcessResultCounts,
  loadProcessSiblingCandidates,
  loadProcessTakeRows,
  type LegacyTakeRow,
  type ProcessLinkSummaryRow,
  type ProcessSiblingCandidateRow,
  type ProcessTakeRow,
} from './queries/takes.query';
import { loadTomaAssessmentRows, type TomaAssessmentRow } from './queries/toma.query';

type TomaResolution = {
  assessmentIds: string[];
  refs: ComparabilityInstrumentRef[];
  label: string;
  academicYearId: string | null;
  instrumentType: InstrumentType | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  processId: string | null;
  processKind: ProcessKind | null;
  redirectProcessId: string | null;
};

type SortableTake = { sortKey: string; take: MasterBoardTake };

type CellAccumulator = {
  aggregate: CellAggregate;
  instrumentIds: Set<string>;
  assessmentIds: Set<string>;
};

type CourseAccumulator = {
  classGroupId: string;
  name: string;
  cells: Map<string, CellAccumulator>;
};

type GradeAccumulator = {
  gradeId: string;
  name: string;
  order: number;
  courses: Map<string, CourseAccumulator>;
  cells: Map<string, CellAccumulator>;
};

type SubjectAccumulator = {
  subjectId: string;
  name: string;
  shortName: string;
  tests: Map<string, MasterBoardTest>;
};

type CellContext = {
  refsByInstrument: Map<string, ComparabilityInstrumentRef>;
  bandsByInstrument: Map<string, EffectiveBands>;
  samples: Map<string, CellSample>;
  canSeeSample: boolean;
};

type CellView = Pick<
  MasterBoardCell,
  'studentsAssessed' | 'metrics' | 'mixed' | 'hasLevels' | 'comparability' | 'sample'
>;

type CellItems = {
  instrumentIds: Set<string>;
  items: Map<string, AchievementTally>;
};

const LEGACY_TAKE_SUFFIX = ' · sin proceso';

@Injectable()
export class MasterBoardService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly samples: BenchmarkSamplesService,
  ) {}

  async getTakes(
    user: JwtPayload,
    query: MasterBoardTakesQueryDto,
  ): Promise<MasterBoardTakesResponse> {
    const orgId = user.orgId;
    if (!orgId) return { takes: [], academicYears: [] };

    return withOrgContext(this.db, orgId, async (tx) => {
      const academicYearsList = await this.loadAcademicYears(tx, orgId);

      const scope = await resolveClassGroupScope(tx, user, orgId);
      if (!scope.scopeAll && scope.classGroupIds.length === 0) {
        return { takes: [], academicYears: academicYearsList };
      }

      const processRows = await loadProcessTakeRows(tx, orgId, scope, query.academicYearId);
      const processIds = processRows.map((row) => row.processId);
      const summaries = await loadProcessLinkSummaries(tx, orgId, scope, processIds);
      const resultCounts = await loadProcessResultCounts(tx, orgId, scope, processIds);
      const siblingCandidates =
        processIds.length > 0 ? await loadProcessSiblingCandidates(tx, orgId) : [];
      const legacyRows = await loadLegacyTakeRows(tx, orgId, scope, query.academicYearId);

      const summaryByProcess = new Map(summaries.map((row) => [row.processId, row]));
      const resultCountByProcess = new Map(
        resultCounts.map((row) => [row.processId, row.assessmentCount]),
      );
      const partialProcessIds = this.findPartialProcessIds(orgId, siblingCandidates);

      const sortable: SortableTake[] = [];
      for (const row of processRows) {
        sortable.push(
          this.toProcessTake(
            row,
            summaryByProcess.get(row.processId),
            resultCountByProcess.get(row.processId) ?? 0,
            partialProcessIds.has(row.processId),
          ),
        );
      }
      for (const row of legacyRows) sortable.push(this.toLegacyTake(row));

      sortable.sort(
        (a, b) =>
          b.sortKey.localeCompare(a.sortKey) || a.take.label.localeCompare(b.take.label, 'es'),
      );

      return { takes: sortable.map((entry) => entry.take), academicYears: academicYearsList };
    });
  }

  async getMatrix(user: JwtPayload, query: MasterBoardMatrixQueryDto): Promise<MasterBoardMatrix> {
    const canSeeSample = this.samples.canSeeSample(user);
    const primaryMetricKey = resolvePrimaryMetricKey(query.metric, canSeeSample);
    const orgId = user.orgId;
    if (!orgId) return this.emptyMatrix(this.emptyToma(query), primaryMetricKey, canSeeSample);

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await resolveClassGroupScope(tx, user, orgId);
      if (!scope.scopeAll && scope.classGroupIds.length === 0) {
        return this.emptyMatrix(this.emptyToma(query), primaryMetricKey, canSeeSample);
      }

      const toma = await this.resolveToma(tx, orgId, scope, query);
      if (toma.assessmentIds.length === 0) {
        return this.emptyMatrix(toma, primaryMetricKey, canSeeSample);
      }

      const filter: MatrixRowsFilter = {
        assessmentIds: toma.assessmentIds,
        scopedClassGroupIds: scope.scopeAll ? null : scope.classGroupIds,
        gradeIds: query.gradeId,
        subjectIds: query.subjectId,
      };
      const rows = await loadMatrixRows(tx, filter);
      const instrumentIds = new Set<string>();
      for (const row of rows) for (const id of row.instrumentIds ?? []) instrumentIds.add(id);
      const bandsByInstrument = await resolveEffectiveBandsForInstruments(tx, [...instrumentIds]);
      const teacherByCell = await this.loadTeachersByCell(
        tx,
        rows.map((row) => row.classGroupId),
      );

      const samples =
        canSeeSample && rows.length > 0
          ? await this.loadCellSamples(tx, orgId, user.userId, filter, scope.scopeAll)
          : new Map<string, CellSample>();

      const { subjects: subjectList, grades: gradeList } = this.assembleMatrix(
        rows,
        teacherByCell,
        {
          refsByInstrument: new Map(toma.refs.map((ref) => [ref.instrumentId, ref])),
          bandsByInstrument,
          samples,
          canSeeSample,
        },
      );

      return {
        take: this.toResolvedTake(toma),
        primaryMetricKey,
        availableMetrics: availableMetrics(canSeeSample),
        subjects: subjectList,
        grades: gradeList,
        comparability: buildComparabilityMeta(toma.refs, toma.assessmentIds.length),
        redirectProcessId: toma.redirectProcessId,
      };
    });
  }

  async getTeacherPerformance(
    user: JwtPayload,
    teacherUserId: string,
    query: TeacherPerformanceQueryDto,
  ): Promise<TeacherPerformance> {
    const primaryMetricKey = resolvePrimaryMetricKey(undefined, false);
    const orgId = user.orgId;
    const empty: TeacherPerformance = {
      teacher: { userId: teacherUserId, name: '', email: '' },
      academicYearId: query.academicYearId ?? null,
      primaryMetricKey,
      classes: [],
    };
    if (!orgId) return empty;

    return withOrgContext(this.db, orgId, async (tx) => {
      const [teacher] = await tx
        .select({ userId: users.id, name: users.name, email: users.email })
        .from(users)
        .innerJoin(orgMemberships, eq(orgMemberships.userId, users.id))
        .where(
          and(
            eq(users.id, teacherUserId),
            eq(orgMemberships.orgId, orgId),
            isNull(users.deletedAt),
          ),
        )
        .limit(1);
      if (!teacher) throw new NotFoundException('Profesor no encontrado');

      const assignmentConditions: SQL[] = [
        eq(teacherAssignments.userId, teacherUserId),
        eq(classGroups.orgId, orgId),
      ];
      if (query.academicYearId) {
        assignmentConditions.push(eq(classGroups.academicYearId, query.academicYearId));
      }

      const assignments = await tx
        .select({
          classGroupId: classGroups.id,
          className: classGroups.name,
          gradeName: grades.name,
          gradeOrder: grades.order,
          subjectId: subjects.id,
          subjectName: subjects.name,
          role: teacherAssignments.role,
        })
        .from(teacherAssignments)
        .innerJoin(subjectClasses, eq(subjectClasses.id, teacherAssignments.subjectClassId))
        .innerJoin(classGroups, eq(classGroups.id, subjectClasses.classGroupId))
        .innerJoin(grades, eq(grades.id, classGroups.gradeId))
        .innerJoin(subjects, eq(subjects.id, subjectClasses.subjectId))
        .where(and(...assignmentConditions));
      if (assignments.length === 0) return { ...empty, teacher };

      const classGroupIds = Array.from(new Set(assignments.map((row) => row.classGroupId)));
      const statByCell = await this.loadCourseSubjectStats(tx, orgId, classGroupIds);
      const context: MetricContext = { bands: LEGACY_PERFORMANCE_BANDS, sample: null };

      const classMap = new Map<string, TeacherPerformanceClass>();
      for (const assignment of assignments) {
        let entry = classMap.get(assignment.classGroupId);
        if (!entry) {
          entry = {
            classGroupId: assignment.classGroupId,
            className: assignment.className,
            gradeName: assignment.gradeName,
            gradeOrder: assignment.gradeOrder,
            subjects: [],
          };
          classMap.set(assignment.classGroupId, entry);
        }
        const cell = statByCell.get(`${assignment.classGroupId}:${assignment.subjectId}`);
        const aggregate = cell?.aggregate ?? emptyCellAggregate();
        entry.subjects.push({
          subjectId: assignment.subjectId,
          subjectName: assignment.subjectName,
          role: assignment.role === 'assistant' ? 'assistant' : 'primary',
          metrics: computeMetrics(aggregate, context, false),
          studentsAssessed: aggregate.studentsAssessed,
          assessmentIds: cell?.assessmentIds ?? [],
        });
      }

      const classes = Array.from(classMap.values()).sort(
        (a, b) => a.gradeOrder - b.gradeOrder || a.className.localeCompare(b.className, 'es'),
      );
      for (const entry of classes) {
        entry.subjects.sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'es'));
      }

      return { teacher, academicYearId: query.academicYearId ?? null, primaryMetricKey, classes };
    });
  }

  private async loadAcademicYears(tx: Database, orgId: string): Promise<MasterBoardAcademicYear[]> {
    const yearRows = await tx
      .select({
        id: academicYears.id,
        year: academicYears.year,
        isCurrent: academicYears.isCurrent,
      })
      .from(academicYears)
      .where(eq(academicYears.orgId, orgId))
      .orderBy(desc(academicYears.year));
    return yearRows.map((row) => ({
      id: row.id,
      year: row.year,
      label: String(row.year),
      isCurrent: row.isCurrent,
    }));
  }

  private toProcessTake(
    row: ProcessTakeRow,
    summary: ProcessLinkSummaryRow | undefined,
    assessmentCount: number,
    partial: boolean,
  ): SortableTake {
    const instrumentTypes = summary?.instrumentTypes ?? [];
    const lastAdministeredAt = summary?.lastAdministeredAt ?? null;
    const firstAdministeredAt = summary?.firstAdministeredAt ?? null;
    return {
      sortKey: lastAdministeredAt ?? (row.startsOn ? `${row.startsOn}T00:00:00` : row.createdAt),
      take: {
        key: `process:${row.processId}`,
        label: row.name,
        academicYearId: row.academicYearId,
        processId: row.processId,
        processKind: row.kind,
        instrumentType: instrumentTypes.length === 1 ? (instrumentTypes[0] ?? null) : null,
        applicationPeriod: row.period,
        administeredFrom: firstAdministeredAt?.slice(0, 10) ?? row.startsOn,
        administeredTo: lastAdministeredAt?.slice(0, 10) ?? row.endsOn,
        assessmentCount,
        linkedAssessmentCount: summary?.linkedAssessmentCount ?? 0,
        hasResults: assessmentCount > 0,
        partial,
      },
    };
  }

  private toLegacyTake(row: LegacyTakeRow): SortableTake {
    const assessmentCount = Number(row.assessmentCount ?? 0);
    return {
      sortKey: row.lastAdministeredAt ?? row.firstCreatedAt,
      take: {
        key: `legacy:${row.academicYearId}:${row.instrumentType}:${row.applicationPeriod ?? '_'}`,
        label: `${this.buildTakeLabel(row.instrumentType, row.applicationPeriod, row.year)}${LEGACY_TAKE_SUFFIX}`,
        academicYearId: row.academicYearId,
        processId: null,
        processKind: null,
        instrumentType: row.instrumentType,
        applicationPeriod: row.applicationPeriod,
        administeredFrom: row.firstAdministeredAt?.slice(0, 10) ?? null,
        administeredTo: row.lastAdministeredAt?.slice(0, 10) ?? null,
        assessmentCount,
        linkedAssessmentCount: assessmentCount,
        hasResults: assessmentCount > 0,
        partial: false,
      },
    };
  }

  private findPartialProcessIds(
    orgId: string,
    candidates: ProcessSiblingCandidateRow[],
  ): Set<string> {
    const cellsByProcess = new Map<string, Map<string, Set<string>>>();
    const processesBySignature = new Map<string, Set<string>>();

    for (const candidate of candidates) {
      if (!candidate.processId) continue;
      let cells = cellsByProcess.get(candidate.processId);
      if (!cells) {
        cells = new Map();
        cellsByProcess.set(candidate.processId, cells);
      }
      const cellKey = this.siblingCellKey(orgId, candidate);
      let instrumentsInCell = cells.get(cellKey);
      if (!instrumentsInCell) {
        instrumentsInCell = new Set();
        cells.set(cellKey, instrumentsInCell);
      }
      instrumentsInCell.add(candidate.instrumentId);

      const signature = this.siblingSignature(candidate);
      let processIds = processesBySignature.get(signature);
      if (!processIds) {
        processIds = new Set();
        processesBySignature.set(signature, processIds);
      }
      processIds.add(candidate.processId);
    }

    const partial = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.processId) continue;
      const processIds = processesBySignature.get(this.siblingSignature(candidate));
      if (!processIds) continue;
      const cellKey = this.siblingCellKey(orgId, candidate);
      for (const processId of processIds) {
        if (partial.has(processId)) continue;
        const instrumentsInCell = cellsByProcess.get(processId)?.get(cellKey);
        const fitsInvariant =
          !instrumentsInCell ||
          (instrumentsInCell.size === 1 && instrumentsInCell.has(candidate.instrumentId));
        if (fitsInvariant) partial.add(processId);
      }
    }
    return partial;
  }

  private siblingSignature(candidate: ProcessSiblingCandidateRow): string {
    return [
      candidate.academicYearId,
      candidate.instrumentType,
      candidate.applicationPeriod ?? '_',
    ].join('|');
  }

  private siblingCellKey(orgId: string, candidate: ProcessSiblingCandidateRow): string {
    const testKey = trackOrSubjectTestKey({ ...candidate, orgId });
    return `${candidate.gradeId}|${testKey ?? '_'}`;
  }

  private async resolveToma(
    tx: Database,
    orgId: string,
    scope: ClassGroupScope,
    query: MasterBoardMatrixQueryDto,
  ): Promise<TomaResolution> {
    if (query.processId) return this.resolveProcessToma(tx, orgId, scope, query.processId);
    if (query.assessmentId?.length) {
      return this.resolveFreeSelectionToma(tx, orgId, scope, query.assessmentId);
    }
    if (!query.academicYearId || !query.instrumentType) return this.emptyToma(query);
    return this.resolveLegacyToma(tx, orgId, scope, {
      academicYearId: query.academicYearId,
      instrumentType: query.instrumentType as InstrumentType,
      applicationPeriod: query.applicationPeriod ?? null,
    });
  }

  private async resolveProcessToma(
    tx: Database,
    orgId: string,
    scope: ClassGroupScope,
    processId: string,
  ): Promise<TomaResolution> {
    const [process] = await tx
      .select({
        id: measurementProcesses.id,
        name: measurementProcesses.name,
        kind: measurementProcesses.kind,
        period: measurementProcesses.period,
        academicYearId: measurementProcesses.academicYearId,
      })
      .from(measurementProcesses)
      .where(
        and(
          eq(measurementProcesses.id, processId),
          eq(measurementProcesses.orgId, orgId),
          isNull(measurementProcesses.deletedAt),
        ),
      )
      .limit(1);
    if (!process) throw new NotFoundException('Proceso de medición no encontrado');

    const conditions: SQL[] = [eq(assessments.processId, process.id)];
    this.pushScopeCondition(conditions, scope);
    const rows = await loadTomaAssessmentRows(tx, orgId, conditions);
    const { assessmentIds, refs } = this.collectToma(rows);

    return {
      assessmentIds,
      refs,
      label: process.name,
      academicYearId: process.academicYearId,
      instrumentType: this.uniqueInstrumentType(refs),
      applicationPeriod: process.period,
      processId: process.id,
      processKind: process.kind,
      redirectProcessId: null,
    };
  }

  private async resolveFreeSelectionToma(
    tx: Database,
    orgId: string,
    scope: ClassGroupScope,
    assessmentIds: string[],
  ): Promise<TomaResolution> {
    const conditions: SQL[] = [inArray(assessments.id, assessmentIds)];
    this.pushScopeCondition(conditions, scope);
    const rows = await loadTomaAssessmentRows(tx, orgId, conditions);
    const toma = this.collectToma(rows);

    return {
      ...toma,
      label: 'Selección personalizada',
      academicYearId: null,
      instrumentType: this.uniqueInstrumentType(toma.refs),
      applicationPeriod: null,
      processId: null,
      processKind: null,
      redirectProcessId: null,
    };
  }

  private async resolveLegacyToma(
    tx: Database,
    orgId: string,
    scope: ClassGroupScope,
    take: {
      academicYearId: string;
      instrumentType: InstrumentType;
      applicationPeriod: InstrumentApplicationPeriod | null;
    },
  ): Promise<TomaResolution> {
    const conditions: SQL[] = [
      sql`${instruments.type}::text = ${take.instrumentType}`,
      eq(classGroups.academicYearId, take.academicYearId),
    ];
    if (take.applicationPeriod) {
      conditions.push(sql`${instruments.applicationPeriod}::text = ${take.applicationPeriod}`);
    }
    this.pushScopeCondition(conditions, scope);
    const rows = await loadTomaAssessmentRows(tx, orgId, conditions);

    const residualRows: TomaAssessmentRow[] = [];
    const linkedProcessIds = new Set<string>();
    for (const row of rows) {
      if (row.activeProcessId) linkedProcessIds.add(row.activeProcessId);
      else residualRows.push(row);
    }
    const { assessmentIds, refs } = this.collectToma(residualRows);
    const redirectProcessId =
      rows.length > 0 && residualRows.length === 0 && linkedProcessIds.size === 1
        ? (Array.from(linkedProcessIds)[0] ?? null)
        : null;
    const year = await this.loadYear(tx, take.academicYearId);

    return {
      assessmentIds,
      refs,
      label: `${this.buildTakeLabel(take.instrumentType, take.applicationPeriod, year)}${LEGACY_TAKE_SUFFIX}`,
      academicYearId: take.academicYearId,
      instrumentType: take.instrumentType,
      applicationPeriod: take.applicationPeriod,
      processId: null,
      processKind: null,
      redirectProcessId,
    };
  }

  private pushScopeCondition(conditions: SQL[], scope: ClassGroupScope): void {
    const inScope = buildAssessmentScopeCondition(scope, {
      classGroupId: assessmentItemStats.classGroupId,
      subjectId: instruments.subjectId,
    });
    if (inScope) conditions.push(inScope);
  }

  private collectToma(rows: TomaAssessmentRow[]): {
    assessmentIds: string[];
    refs: ComparabilityInstrumentRef[];
  } {
    const ids = new Set<string>();
    const byInstrument = new Map<string, ComparabilityInstrumentRef>();
    for (const row of rows) {
      ids.add(row.assessmentId);
      if (!byInstrument.has(row.instrumentId)) {
        byInstrument.set(row.instrumentId, {
          instrumentId: row.instrumentId,
          type: row.instrumentType,
          subjectId: row.subjectId,
          gradeId: row.gradeId,
          applicationPeriod: row.applicationPeriod,
          year: row.year,
          trackId: row.trackId,
        });
      }
    }
    return { assessmentIds: Array.from(ids), refs: Array.from(byInstrument.values()) };
  }

  private uniqueInstrumentType(refs: ComparabilityInstrumentRef[]): InstrumentType | null {
    const types = new Set(refs.map((ref) => ref.type));
    return types.size === 1 ? (Array.from(types)[0] as InstrumentType) : null;
  }

  private async loadYear(tx: Database, academicYearId: string): Promise<number | null> {
    const [row] = await tx
      .select({ year: academicYears.year })
      .from(academicYears)
      .where(eq(academicYears.id, academicYearId))
      .limit(1);
    return row?.year ?? null;
  }

  private emptyToma(query: MasterBoardMatrixQueryDto): TomaResolution {
    return {
      assessmentIds: [],
      refs: [],
      label: '',
      academicYearId: query.academicYearId ?? null,
      instrumentType: null,
      applicationPeriod: query.applicationPeriod ?? null,
      processId: query.processId ?? null,
      processKind: null,
      redirectProcessId: null,
    };
  }

  private toResolvedTake(toma: TomaResolution): MasterBoardMatrix['take'] {
    return {
      label: toma.label,
      processId: toma.processId,
      processKind: toma.processKind,
      academicYearId: toma.academicYearId,
      instrumentType: toma.instrumentType,
      applicationPeriod: toma.applicationPeriod,
      assessmentIds: toma.assessmentIds,
    };
  }

  private emptyMatrix(
    toma: TomaResolution,
    primaryMetricKey: MasterBoardMatrix['primaryMetricKey'],
    canSeeSample: boolean,
  ): MasterBoardMatrix {
    return {
      take: this.toResolvedTake(toma),
      primaryMetricKey,
      availableMetrics: availableMetrics(canSeeSample),
      subjects: [],
      grades: [],
      comparability: buildComparabilityMeta([]),
      redirectProcessId: toma.redirectProcessId,
    };
  }

  private async loadCourseSubjectStats(tx: Database, orgId: string, classGroupIds: string[]) {
    const map = new Map<string, { aggregate: CellAggregate; assessmentIds: string[] }>();
    if (classGroupIds.length === 0) return map;

    const rows = await tx
      .select({
        classGroupId: assessmentItemStats.classGroupId,
        subjectId: instruments.subjectId,
        scoreSum: sql<string | null>`sum(${assessmentItemStats.scoreSum}::numeric)`,
        maxSum: sql<string | null>`sum(${assessmentItemStats.maxSum}::numeric)`,
        studentsAssessed: sql<number>`max(${assessmentItemStats.studentCount})::int`,
        assessmentIds: sql<string[]>`array_agg(distinct ${assessments.id})`,
      })
      .from(assessmentItemStats)
      .innerJoin(assessments, eq(assessments.id, assessmentItemStats.assessmentId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .where(
        and(
          eq(assessments.orgId, orgId),
          inArray(assessmentItemStats.classGroupId, classGroupIds),
          sql`${instruments.subjectId} is not null`,
        ),
      )
      .groupBy(assessmentItemStats.classGroupId, instruments.subjectId);

    for (const row of rows) {
      if (row.subjectId === null) continue;
      map.set(`${row.classGroupId}:${row.subjectId}`, {
        aggregate: {
          scoreSum: row.scoreSum === null ? 0 : Number(row.scoreSum),
          maxSum: row.maxSum === null ? 0 : Number(row.maxSum),
          studentsAssessed: Number(row.studentsAssessed ?? 0),
        },
        assessmentIds: row.assessmentIds ?? [],
      });
    }
    return map;
  }

  private async loadTeachersByCell(
    tx: Database,
    classGroupIds: string[],
  ): Promise<Map<string, MasterBoardTeacherRef>> {
    const map = new Map<string, MasterBoardTeacherRef>();
    const uniqueIds = Array.from(new Set(classGroupIds));
    if (uniqueIds.length === 0) return map;

    const rows = await tx
      .select({
        classGroupId: subjectClasses.classGroupId,
        subjectId: subjectClasses.subjectId,
        userId: users.id,
        name: users.name,
      })
      .from(teacherAssignments)
      .innerJoin(subjectClasses, eq(subjectClasses.id, teacherAssignments.subjectClassId))
      .innerJoin(users, eq(users.id, teacherAssignments.userId))
      .where(
        and(
          inArray(subjectClasses.classGroupId, uniqueIds),
          eq(teacherAssignments.role, 'primary'),
          isNull(users.deletedAt),
        ),
      );

    for (const row of rows) {
      const key = `${row.classGroupId}:${row.subjectId}`;
      if (!map.has(key)) map.set(key, { userId: row.userId, name: row.name });
    }
    return map;
  }

  private assembleMatrix(
    rows: MatrixRow[],
    teacherByCell: Map<string, MasterBoardTeacherRef>,
    context: CellContext,
  ): { subjects: MasterBoardSubject[]; grades: MasterBoardGrade[] } {
    const subjectMap = new Map<string, SubjectAccumulator>();
    const gradeMap = new Map<string, GradeAccumulator>();

    for (const row of rows) {
      const testKey = row.trackId ? `track:${row.trackId}` : `subject:${row.subjectId}`;
      this.registerTest(subjectMap, row, testKey);

      const aggregate: CellAggregate = {
        scoreSum: row.scoreSum === null ? 0 : Number(row.scoreSum),
        maxSum: row.maxSum === null ? 0 : Number(row.maxSum),
        studentsAssessed: Number(row.studentsAssessed ?? 0),
      };

      let grade = gradeMap.get(row.gradeId);
      if (!grade) {
        grade = {
          gradeId: row.gradeId,
          name: row.gradeName,
          order: row.gradeOrder,
          courses: new Map(),
          cells: new Map(),
        };
        gradeMap.set(row.gradeId, grade);
      }

      let course = grade.courses.get(row.classGroupId);
      if (!course) {
        course = { classGroupId: row.classGroupId, name: row.classGroupName, cells: new Map() };
        grade.courses.set(row.classGroupId, course);
      }

      this.accumulateCell(course.cells, testKey, aggregate, row);
      this.accumulateCell(grade.cells, testKey, aggregate, row);
    }

    const subjectList: MasterBoardSubject[] = Array.from(subjectMap.values())
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .map((subject) => ({
        subjectId: subject.subjectId,
        name: subject.name,
        shortName: subject.shortName,
        tests: Array.from(subject.tests.values()).sort(
          (a, b) => a.order - b.order || a.name.localeCompare(b.name, 'es'),
        ),
      }));

    const gradeList = Array.from(gradeMap.values())
      .sort((a, b) => a.order - b.order)
      .map((grade) => this.toGrade(grade, subjectList, teacherByCell, context));

    return { subjects: subjectList, grades: gradeList };
  }

  private registerTest(
    subjectMap: Map<string, SubjectAccumulator>,
    row: MatrixRow,
    testKey: string,
  ): void {
    let subject = subjectMap.get(row.subjectId);
    if (!subject) {
      subject = {
        subjectId: row.subjectId,
        name: row.subjectName,
        shortName: row.subjectShortName,
        tests: new Map(),
      };
      subjectMap.set(row.subjectId, subject);
    }

    const source: MasterBoardTestSource = row.fromElectiveInstrument
      ? 'section'
      : row.trackId
        ? 'instrument'
        : 'subject';
    const existing = subject.tests.get(testKey);
    if (existing) {
      if (source === 'section') existing.source = 'section';
      return;
    }
    subject.tests.set(testKey, {
      testKey,
      trackId: row.trackId,
      source,
      name: row.trackId ? (row.trackName ?? row.subjectName) : row.subjectName,
      shortName: row.trackId ? (row.trackShortName ?? row.subjectShortName) : row.subjectShortName,
      order: row.trackId ? (row.trackOrder ?? 0) : 0,
      hasLevels: false,
      mixed: false,
    });
  }

  private accumulateCell(
    cells: Map<string, CellAccumulator>,
    testKey: string,
    aggregate: CellAggregate,
    row: MatrixRow,
  ): void {
    let cell = cells.get(testKey);
    if (!cell) {
      cell = {
        aggregate: emptyCellAggregate(),
        instrumentIds: new Set(),
        assessmentIds: new Set(),
      };
      cells.set(testKey, cell);
    }
    addToCellAggregate(cell.aggregate, aggregate);
    for (const id of row.instrumentIds ?? []) cell.instrumentIds.add(id);
    for (const id of row.assessmentIds ?? []) cell.assessmentIds.add(id);
  }

  private toGrade(
    grade: GradeAccumulator,
    subjectList: MasterBoardSubject[],
    teacherByCell: Map<string, MasterBoardTeacherRef>,
    context: CellContext,
  ): MasterBoardGrade {
    const cells: MasterBoardCell[] = [];
    for (const subject of subjectList) {
      for (const test of subject.tests) {
        const view = this.buildCellView(
          grade.cells.get(test.testKey),
          test,
          context,
          this.gradeCellKey(grade.gradeId, test.testKey),
        );
        if (view.hasLevels) test.hasLevels = true;
        if (view.mixed) test.mixed = true;
        cells.push({ subjectId: subject.subjectId, testKey: test.testKey, ...view });
      }
    }

    const courses = Array.from(grade.courses.values())
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .map((course) => {
        const courseCells: MasterBoardCourseCell[] = [];
        for (const subject of subjectList) {
          for (const test of subject.tests) {
            const cell = course.cells.get(test.testKey);
            courseCells.push({
              subjectId: subject.subjectId,
              testKey: test.testKey,
              ...this.buildCellView(
                cell,
                test,
                context,
                this.courseCellKey(course.classGroupId, test.testKey),
              ),
              teacher: teacherByCell.get(`${course.classGroupId}:${subject.subjectId}`) ?? null,
              assessmentIds: cell ? Array.from(cell.assessmentIds) : [],
            });
          }
        }
        return { classGroupId: course.classGroupId, name: course.name, cells: courseCells };
      });

    return { gradeId: grade.gradeId, name: grade.name, order: grade.order, cells, courses };
  }

  private buildCellView(
    cell: CellAccumulator | undefined,
    test: MasterBoardTest,
    context: CellContext,
    sampleKey: string,
  ): CellView {
    const aggregate = cell?.aggregate ?? emptyCellAggregate();
    const instrumentIds = cell ? Array.from(cell.instrumentIds) : [];
    const refs: ComparabilityInstrumentRef[] = [];
    for (const id of instrumentIds) {
      const ref = context.refsByInstrument.get(id);
      if (ref) refs.push(ref);
    }
    const singleInstrumentId = instrumentIds.length === 1 ? instrumentIds[0] : undefined;
    const bands =
      test.source !== 'section' && singleInstrumentId
        ? (context.bandsByInstrument.get(singleInstrumentId)?.bands ?? [])
        : [];
    const hasLevels = bands.length > 0;
    const sample = singleInstrumentId ? (context.samples.get(sampleKey) ?? null) : null;
    const metrics: MetricValue[] = computeMetrics(
      aggregate,
      { bands: hasLevels ? bands : null, sample },
      context.canSeeSample,
    );

    return {
      studentsAssessed: aggregate.studentsAssessed,
      metrics,
      mixed: test.source === 'subject' && instrumentIds.length > 1,
      hasLevels,
      comparability: buildComparabilityMeta(refs, cell?.assessmentIds.size),
      sample,
    };
  }

  private gradeCellKey(gradeId: string, testKey: string): string {
    return `grade:${gradeId}:${testKey}`;
  }

  private courseCellKey(classGroupId: string, testKey: string): string {
    return `course:${classGroupId}:${testKey}`;
  }

  private async loadCellSamples(
    tx: Database,
    orgId: string,
    userId: string,
    filter: MatrixRowsFilter,
    fullScope: boolean,
  ): Promise<Map<string, CellSample>> {
    const itemRows = await loadMatrixItemTallies(tx, filter);
    const cells = new Map<string, CellItems>();
    const gradeKeys = new Set<string>();
    for (const row of itemRows) {
      const testKey = row.trackId ? `track:${row.trackId}` : `subject:${row.subjectId}`;
      const gradeKey = this.gradeCellKey(row.gradeId, testKey);
      gradeKeys.add(gradeKey);
      const tally = { scoreSum: Number(row.scoreSum), maxSum: Number(row.maxSum) };
      for (const key of [gradeKey, this.courseCellKey(row.classGroupId, testKey)]) {
        let cell = cells.get(key);
        if (!cell) {
          cell = { instrumentIds: new Set(), items: new Map() };
          cells.set(key, cell);
        }
        cell.instrumentIds.add(row.instrumentId);
        const itemTally = cell.items.get(row.itemId);
        if (itemTally) addTally(itemTally, tally);
        else cell.items.set(row.itemId, { ...tally });
      }
    }

    const requests: ItemSetRequest[] = [];
    for (const [key, cell] of cells) {
      const [instrumentId] = cell.instrumentIds;
      if (cell.instrumentIds.size !== 1 || !instrumentId) continue;
      requests.push({ key, instrumentId, itemIds: Array.from(cell.items.keys()) });
    }
    const results = await this.samples.getItemSetSamples(requests, tx);

    const samples = new Map<string, CellSample>();
    const sampledInstruments = new Set<string>();
    for (const [key, result] of results) {
      const cell = cells.get(key);
      if (!cell) continue;
      sampledInstruments.add(result.instrumentId);
      samples.set(key, this.toCellSample(result, cell, fullScope && gradeKeys.has(key)));
    }
    if (sampledInstruments.size > 0) {
      await this.samples.logSampleAccess(tx, orgId, userId, Array.from(sampledInstruments));
    }
    return samples;
  }

  private toCellSample(
    result: ItemSetSampleResult,
    cell: CellItems,
    withPosition: boolean,
  ): CellSample {
    const cellTally = emptyTally();
    for (const itemId of result.comparedItemIds) {
      const itemTally = cell.items.get(itemId);
      if (itemTally) addTally(cellTally, itemTally);
    }
    const cellPct = achievementPct(cellTally);
    const cellValue = cellPct === null ? null : round2(cellPct);
    const p25 = percentileOf(result.schoolValues, 25);
    const p75 = percentileOf(result.schoolValues, 75);
    return {
      instrumentId: result.instrumentId,
      label: result.label,
      value: result.value,
      cellValue,
      deltaPp: sampleDeltaPp(cellValue, result.value),
      schoolCount: result.schoolCount,
      studentCount: result.studentCount,
      comparedItems: result.comparedItemIds.length,
      totalItems: cell.items.size,
      percentile: withPosition ? percentileRank(result.schoolValues, cellValue) : null,
      typicalZone: withPosition ? classifyTypicalZone(cellValue, p25, p75) : null,
      refreshedAt: result.refreshedAt,
    };
  }

  private buildTakeLabel(
    instrumentType: InstrumentType,
    applicationPeriod: InstrumentApplicationPeriod | null,
    year: number | null,
  ): string {
    const parts: string[] = [INSTRUMENT_TYPE_LABELS[instrumentType]];
    if (applicationPeriod) parts.push(INSTRUMENT_APPLICATION_PERIOD_LABELS[applicationPeriod]);
    if (year !== null) parts.push(String(year));
    return parts.join(' ');
  }
}
