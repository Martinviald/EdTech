import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  academicYears,
  assessmentItemStats,
  assessments,
  classGroups,
  grades,
  gradingScales,
  instruments,
  orgMemberships,
  subjectClasses,
  subjects,
  teacherAssignments,
  users,
  withOrgContext,
} from '@soe/db';
import {
  INSTRUMENT_APPLICATION_PERIODS,
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  INSTRUMENT_TYPE_LABELS,
  buildComparabilityMeta,
  type ComparabilityInstrumentRef,
  type InstrumentApplicationPeriod,
  type InstrumentType,
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
  type TeacherPerformance,
  type TeacherPerformanceClass,
  type TeacherPerformanceQueryDto,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import {
  resolveClassGroupScope,
  type ClassGroupScope,
} from '../common/helpers/class-group-scope.helper';
import { InjectDb, type Database } from '../database/database.types';
import {
  addToCellAggregate,
  availableMetrics,
  computeMetrics,
  emptyCellAggregate,
  resolvePrimaryMetricKey,
  resolveThresholds,
  type CellAggregate,
  type MetricContext,
} from './master-board.metrics';

type TomaResolution = {
  assessmentIds: string[];
  refs: ComparabilityInstrumentRef[];
  instrumentType: InstrumentType | null;
};

type MatrixRow = {
  gradeId: string;
  gradeName: string;
  gradeOrder: number;
  classGroupId: string;
  classGroupName: string;
  subjectId: string;
  subjectName: string;
  subjectShortName: string;
  scoreSum: string | null;
  maxSum: string | null;
  studentsAssessed: number;
  assessmentIds: string[];
};

type CourseAccumulator = {
  classGroupId: string;
  name: string;
  cells: Map<string, { aggregate: CellAggregate; assessmentIds: string[] }>;
};

type GradeAccumulator = {
  gradeId: string;
  name: string;
  order: number;
  courses: Map<string, CourseAccumulator>;
  cellsBySubject: Map<string, CellAggregate>;
};

@Injectable()
export class MasterBoardService {
  constructor(@InjectDb() private readonly db: Database) {}

  async getTakes(
    user: JwtPayload,
    query: MasterBoardTakesQueryDto,
  ): Promise<MasterBoardTakesResponse> {
    const orgId = user.orgId;
    if (!orgId) return { takes: [], academicYears: [] };

    return withOrgContext(this.db, orgId, async (tx) => {
      const yearRows = await tx
        .select({
          id: academicYears.id,
          year: academicYears.year,
          isCurrent: academicYears.isCurrent,
        })
        .from(academicYears)
        .where(eq(academicYears.orgId, orgId))
        .orderBy(desc(academicYears.year));
      const academicYearsList = yearRows.map((row) => ({
        id: row.id,
        year: row.year,
        label: String(row.year),
        isCurrent: row.isCurrent,
      }));

      const scope = await resolveClassGroupScope(tx, user, orgId);
      if (!scope.scopeAll && scope.classGroupIds.length === 0) {
        return { takes: [], academicYears: academicYearsList };
      }

      const conditions: SQL[] = [eq(assessments.orgId, orgId), isNull(instruments.deletedAt)];
      if (!scope.scopeAll) {
        conditions.push(inArray(assessmentItemStats.classGroupId, scope.classGroupIds));
      }
      if (query.academicYearId) {
        conditions.push(eq(classGroups.academicYearId, query.academicYearId));
      }

      const rows = await tx
        .select({
          academicYearId: classGroups.academicYearId,
          year: academicYears.year,
          instrumentType: instruments.type,
          applicationPeriod: instruments.applicationPeriod,
          assessmentCount: sql<number>`count(distinct ${assessments.id})::int`,
        })
        .from(assessmentItemStats)
        .innerJoin(assessments, eq(assessments.id, assessmentItemStats.assessmentId))
        .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
        .innerJoin(classGroups, eq(classGroups.id, assessmentItemStats.classGroupId))
        .innerJoin(academicYears, eq(academicYears.id, classGroups.academicYearId))
        .where(and(...conditions))
        .groupBy(
          classGroups.academicYearId,
          academicYears.year,
          instruments.type,
          instruments.applicationPeriod,
        );

      const takes = rows
        .map((row) => {
          const instrumentType = row.instrumentType as InstrumentType;
          const applicationPeriod = row.applicationPeriod;
          return {
            year: row.year,
            take: {
              key: `${row.academicYearId}:${instrumentType}:${applicationPeriod ?? '_'}`,
              label: this.buildTakeLabel(instrumentType, applicationPeriod, row.year),
              academicYearId: row.academicYearId,
              instrumentType,
              applicationPeriod,
              assessmentCount: Number(row.assessmentCount ?? 0),
            } satisfies MasterBoardTake,
          };
        })
        .sort((a, b) => {
          if (a.year !== b.year) return b.year - a.year;
          if (a.take.instrumentType !== b.take.instrumentType) {
            return a.take.instrumentType.localeCompare(b.take.instrumentType, 'es');
          }
          return (
            this.periodOrder(a.take.applicationPeriod) - this.periodOrder(b.take.applicationPeriod)
          );
        })
        .map((entry) => entry.take);

      return { takes, academicYears: academicYearsList };
    });
  }

  async getMatrix(user: JwtPayload, query: MasterBoardMatrixQueryDto): Promise<MasterBoardMatrix> {
    const primaryMetricKey = resolvePrimaryMetricKey(query.metric);
    const metrics = availableMetrics();
    const orgId = user.orgId;

    const emptyMatrix = (instrumentType: InstrumentType | null): MasterBoardMatrix => ({
      take: {
        label: '',
        academicYearId: query.academicYearId ?? null,
        instrumentType,
        applicationPeriod: query.applicationPeriod ?? null,
        assessmentIds: [],
      },
      primaryMetricKey,
      availableMetrics: metrics,
      subjects: [],
      grades: [],
      comparability: buildComparabilityMeta([]),
    });

    if (!orgId) return emptyMatrix(null);

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await resolveClassGroupScope(tx, user, orgId);
      if (!scope.scopeAll && scope.classGroupIds.length === 0) return emptyMatrix(null);

      const toma = await this.resolveTomaAssessments(tx, orgId, scope, query);
      if (toma.assessmentIds.length === 0) return emptyMatrix(toma.instrumentType);

      const comparability = buildComparabilityMeta(toma.refs, toma.assessmentIds.length);
      const thresholds = await this.resolveTomaThresholds(tx, toma.assessmentIds);
      const context: MetricContext = { thresholds, aggregatable: comparability.aggregatable };

      const scopedClassGroupIds = scope.scopeAll ? null : scope.classGroupIds;
      const rows = await this.loadMatrixRows(tx, toma.assessmentIds, scopedClassGroupIds, query);
      const teacherByCell = await this.loadTeachersByCell(
        tx,
        rows.map((row) => row.classGroupId),
      );
      const label = await this.resolveTakeLabel(tx, toma, query);

      const { subjects: subjectList, grades: gradeList } = this.assembleMatrix(
        rows,
        teacherByCell,
        context,
      );

      return {
        take: {
          label,
          academicYearId: query.academicYearId ?? null,
          instrumentType: toma.instrumentType,
          applicationPeriod: query.applicationPeriod ?? null,
          assessmentIds: toma.assessmentIds,
        },
        primaryMetricKey,
        availableMetrics: metrics,
        subjects: subjectList,
        grades: gradeList,
        comparability,
      };
    });
  }

  async getTeacherPerformance(
    user: JwtPayload,
    teacherUserId: string,
    query: TeacherPerformanceQueryDto,
  ): Promise<TeacherPerformance> {
    const primaryMetricKey = resolvePrimaryMetricKey(undefined);
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
      const context: MetricContext = { thresholds: resolveThresholds(null), aggregatable: true };

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
          metrics: computeMetrics(aggregate, context),
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

  private async resolveTomaAssessments(
    tx: Database,
    orgId: string,
    scope: ClassGroupScope,
    query: MasterBoardMatrixQueryDto,
  ): Promise<TomaResolution> {
    const isFreeSelection = !!query.assessmentId?.length;
    const conditions: SQL[] = [eq(assessments.orgId, orgId), isNull(instruments.deletedAt)];
    let instrumentType: InstrumentType | null = null;

    if (isFreeSelection) {
      conditions.push(inArray(assessments.id, query.assessmentId!));
    } else {
      if (!query.academicYearId || !query.instrumentType) {
        return { assessmentIds: [], refs: [], instrumentType: null };
      }
      instrumentType = query.instrumentType as InstrumentType;
      conditions.push(sql`${instruments.type}::text = ${query.instrumentType}`);
      if (query.applicationPeriod) {
        conditions.push(sql`${instruments.applicationPeriod}::text = ${query.applicationPeriod}`);
      }
      conditions.push(eq(classGroups.academicYearId, query.academicYearId));
    }
    if (!scope.scopeAll) {
      conditions.push(inArray(assessmentItemStats.classGroupId, scope.classGroupIds));
    }

    const rows = await tx
      .selectDistinct({
        assessmentId: assessments.id,
        instrumentId: instruments.id,
        instrumentType: instruments.type,
        subjectId: instruments.subjectId,
        gradeId: instruments.gradeId,
        applicationPeriod: instruments.applicationPeriod,
        year: instruments.year,
      })
      .from(assessmentItemStats)
      .innerJoin(assessments, eq(assessments.id, assessmentItemStats.assessmentId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .innerJoin(classGroups, eq(classGroups.id, assessmentItemStats.classGroupId))
      .where(and(...conditions));

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
        });
      }
    }

    if (isFreeSelection && byInstrument.size > 0) {
      const distinctTypes = new Set(Array.from(byInstrument.values()).map((ref) => ref.type));
      instrumentType =
        distinctTypes.size === 1 ? (Array.from(distinctTypes)[0] as InstrumentType) : null;
    }

    return {
      assessmentIds: Array.from(ids),
      refs: Array.from(byInstrument.values()),
      instrumentType,
    };
  }

  private async resolveTomaThresholds(tx: Database, assessmentIds: string[]) {
    const [row] = await tx
      .select({ config: gradingScales.config })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .innerJoin(gradingScales, eq(gradingScales.id, instruments.gradingScaleId))
      .where(inArray(assessments.id, assessmentIds))
      .orderBy(asc(instruments.createdAt))
      .limit(1);
    return resolveThresholds(row?.config ?? null);
  }

  private async loadMatrixRows(
    tx: Database,
    assessmentIds: string[],
    scopedClassGroupIds: string[] | null,
    query: MasterBoardMatrixQueryDto,
  ): Promise<MatrixRow[]> {
    const conditions: SQL[] = [
      inArray(assessments.id, assessmentIds),
      sql`${instruments.subjectId} is not null`,
    ];
    if (scopedClassGroupIds !== null) {
      conditions.push(inArray(assessmentItemStats.classGroupId, scopedClassGroupIds));
    }
    if (query.gradeId?.length) conditions.push(inArray(classGroups.gradeId, query.gradeId));
    if (query.subjectId?.length) conditions.push(inArray(instruments.subjectId, query.subjectId));

    return tx
      .select({
        gradeId: classGroups.gradeId,
        gradeName: grades.name,
        gradeOrder: grades.order,
        classGroupId: assessmentItemStats.classGroupId,
        classGroupName: classGroups.name,
        subjectId: subjects.id,
        subjectName: subjects.name,
        subjectShortName: subjects.shortName,
        scoreSum: sql<string | null>`sum(${assessmentItemStats.scoreSum}::numeric)`,
        maxSum: sql<string | null>`sum(${assessmentItemStats.maxSum}::numeric)`,
        studentsAssessed: sql<number>`max(${assessmentItemStats.studentCount})::int`,
        assessmentIds: sql<string[]>`array_agg(distinct ${assessments.id})`,
      })
      .from(assessmentItemStats)
      .innerJoin(assessments, eq(assessments.id, assessmentItemStats.assessmentId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .innerJoin(subjects, eq(subjects.id, instruments.subjectId))
      .innerJoin(classGroups, eq(classGroups.id, assessmentItemStats.classGroupId))
      .innerJoin(grades, eq(grades.id, classGroups.gradeId))
      .where(and(...conditions))
      .groupBy(
        classGroups.gradeId,
        grades.name,
        grades.order,
        assessmentItemStats.classGroupId,
        classGroups.name,
        subjects.id,
        subjects.name,
        subjects.shortName,
      );
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
    context: MetricContext,
  ): { subjects: MasterBoardSubject[]; grades: MasterBoardGrade[] } {
    const subjectMap = new Map<string, MasterBoardSubject>();
    const gradeMap = new Map<string, GradeAccumulator>();

    for (const row of rows) {
      if (!subjectMap.has(row.subjectId)) {
        subjectMap.set(row.subjectId, {
          subjectId: row.subjectId,
          name: row.subjectName,
          shortName: row.subjectShortName,
        });
      }

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
          cellsBySubject: new Map(),
        };
        gradeMap.set(row.gradeId, grade);
      }

      let course = grade.courses.get(row.classGroupId);
      if (!course) {
        course = { classGroupId: row.classGroupId, name: row.classGroupName, cells: new Map() };
        grade.courses.set(row.classGroupId, course);
      }
      course.cells.set(row.subjectId, {
        aggregate,
        assessmentIds: row.assessmentIds ?? [],
      });

      let gradeCell = grade.cellsBySubject.get(row.subjectId);
      if (!gradeCell) {
        gradeCell = emptyCellAggregate();
        grade.cellsBySubject.set(row.subjectId, gradeCell);
      }
      addToCellAggregate(gradeCell, aggregate);
    }

    const subjectList = Array.from(subjectMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'es'),
    );

    const gradeList = Array.from(gradeMap.values())
      .sort((a, b) => a.order - b.order)
      .map((grade) => this.toGrade(grade, subjectList, teacherByCell, context));

    return { subjects: subjectList, grades: gradeList };
  }

  private toGrade(
    grade: GradeAccumulator,
    subjectList: MasterBoardSubject[],
    teacherByCell: Map<string, MasterBoardTeacherRef>,
    context: MetricContext,
  ): MasterBoardGrade {
    const cells: MasterBoardCell[] = subjectList.map((subject) => {
      const aggregate = grade.cellsBySubject.get(subject.subjectId) ?? emptyCellAggregate();
      return {
        subjectId: subject.subjectId,
        studentsAssessed: aggregate.studentsAssessed,
        metrics: computeMetrics(aggregate, context),
      };
    });

    const courses = Array.from(grade.courses.values())
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .map((course) => ({
        classGroupId: course.classGroupId,
        name: course.name,
        cells: subjectList.map((subject): MasterBoardCourseCell => {
          const cell = course.cells.get(subject.subjectId);
          const aggregate = cell?.aggregate ?? emptyCellAggregate();
          return {
            subjectId: subject.subjectId,
            studentsAssessed: aggregate.studentsAssessed,
            metrics: computeMetrics(aggregate, context),
            teacher: teacherByCell.get(`${course.classGroupId}:${subject.subjectId}`) ?? null,
            assessmentIds: cell?.assessmentIds ?? [],
          };
        }),
      }));

    return {
      gradeId: grade.gradeId,
      name: grade.name,
      order: grade.order,
      cells,
      courses,
    };
  }

  private async resolveTakeLabel(
    tx: Database,
    toma: TomaResolution,
    query: MasterBoardMatrixQueryDto,
  ): Promise<string> {
    if (query.assessmentId?.length) return 'Selección personalizada';
    if (!query.academicYearId || !toma.instrumentType) return '';
    const [row] = await tx
      .select({ year: academicYears.year })
      .from(academicYears)
      .where(eq(academicYears.id, query.academicYearId))
      .limit(1);
    return this.buildTakeLabel(
      toma.instrumentType,
      query.applicationPeriod ?? null,
      row?.year ?? null,
    );
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

  private periodOrder(period: InstrumentApplicationPeriod | null): number {
    if (period === null) return INSTRUMENT_APPLICATION_PERIODS.length;
    return INSTRUMENT_APPLICATION_PERIODS.indexOf(period);
  }
}
