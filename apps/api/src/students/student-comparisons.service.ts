import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  academicYears,
  assessmentItemStats,
  assessments,
  classGroups,
  instruments,
  preferComputedOverImported,
  studentEnrollments,
  withOrgContext,
  resolveEffectiveBands,
} from '@soe/db';
import {
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  INSTRUMENT_APPLICATION_PERIODS,
  achievementPct,
  addTally,
  bandToLegacyLevel,
  buildComparabilityMeta,
  buildInstrumentFamilyKey,
  classifyByBands,
  deltaInPoints,
  emptyTally,
  tallyOf,
  type AchievementTally,
  type CohortStat,
  type ComparabilityInstrumentRef,
  type ComparableUnitClassGroup,
  type InstrumentApplicationPeriod,
  type PerformanceBandInput,
  type PerformanceBandView,
  type StudentComparisonAnchor,
  type StudentComparisonsQueryDto,
  type StudentComparisonsResponse,
  type StudentPanoramaAssessment,
  type StudentSubjectComparison,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import {
  isStudentVisibleInScope,
  resolveClassGroupScope,
  resolveStudentSubjectFilter,
} from '../common/helpers/class-group-scope.helper';
import { ComparableUnitAssembler } from '../dashboards/comparable/comparable-unit.assembler';
import { InjectDb, type Database } from '../database/database.types';
import { loadStudentAssessments } from './lib/load-student-assessments';

type ResolvedFilters = {
  subjectId: string | null;
  instrumentType: string | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  year: number | null;
};

type Anchor = {
  instrumentId: string;
  instrumentType: string;
  subjectId: string | null;
  subjectName: string | null;
  gradeId: string | null;
  year: number | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  trackId: string | null;
  achievement: number | null;
  performanceBand: PerformanceBandView | null;
  performanceLevel: StudentPanoramaAssessment['performanceLevel'];
  ref: StudentComparisonAnchor;
};

type GradeCourses = {
  courses: ComparableUnitClassGroup[];
  tallies: Map<string, AchievementTally>;
};

type FamilyInstrument = {
  instrumentId: string;
  year: number;
  ref: ComparabilityInstrumentRef;
};

/**
 * GET /api/students/:studentId/comparisons — comparativas 360 del estudiante (F2 · B2).
 *
 * Por cada asignatura del alumno se elige un ANCLA (su evaluación comparable más
 * reciente) y se lo compara contra tres cohortes AGREGADAS: su curso, su nivel (grado
 * completo) y las generaciones anteriores (mismo grado + familia, años previos). Todo en
 * % de logro comparable, sin promediar escalas incomparables.
 *
 * Reutiliza `ComparableUnitAssembler` para el desglose por curso — la misma maquinaria
 * que el Panorama y la Trayectoria. Las cohortes son conteos, nunca per-alumno → sin
 * fuga de PII. Un profesor sólo ve sus cursos: las cohortes se acotan a su alcance
 * (`resolveClassGroupScope`) vía `loadByClassGroup`.
 */
@Injectable()
export class StudentComparisonsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly assembler: ComparableUnitAssembler,
  ) {}

  async getComparisons(
    user: JwtPayload,
    studentId: string,
    query: StudentComparisonsQueryDto = {},
  ): Promise<StudentComparisonsResponse> {
    const orgId = user.orgId;
    if (orgId === null) {
      throw new ForbiddenException('Usuario sin organización activa');
    }

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await resolveClassGroupScope(tx, user, orgId);
      const responseScope = scope.scopeAll ? 'org' : 'teacher';

      const visible = await isStudentVisibleInScope(tx, orgId, scope, studentId);
      if (!visible) {
        throw new NotFoundException('Estudiante no encontrado');
      }

      // Alcance por asignatura: de un alumno visible, un profesor de asignatura
      // sólo ve lo suyo; el profesor jefe ve el perfil completo del alumno
      // (docs/diseno-alcance-docente.md §3.1).
      const subjectFilter = await resolveStudentSubjectFilter(tx, scope, studentId);
      const rawAssessments = (await loadStudentAssessments(tx, orgId, studentId)).filter(
        (a) => subjectFilter === null || (a.subjectId !== null && subjectFilter.has(a.subjectId)),
      );
      const filters = this.resolveFilters(query, rawAssessments);
      const byAssessment = this.applyFilters(rawAssessments, filters);
      if (byAssessment.length === 0) {
        return { scope: responseScope, subjects: [] };
      }

      const cohortClassGroupIds = scope.scopeAll ? null : scope.classGroupIds;
      const bandsByInstrument = new Map<string, PerformanceBandInput[]>();

      const subjects: StudentSubjectComparison[] = [];
      for (const group of this.groupBySubject(byAssessment)) {
        subjects.push(
          await this.buildSubjectComparison(
            tx,
            orgId,
            studentId,
            group,
            cohortClassGroupIds,
            bandsByInstrument,
          ),
        );
      }

      subjects.sort((a, b) => (a.subjectName ?? 'zzz').localeCompare(b.subjectName ?? 'zzz', 'es'));

      return { scope: responseScope, subjects };
    });
  }

  private async buildSubjectComparison(
    tx: Database,
    orgId: string,
    studentId: string,
    group: StudentPanoramaAssessment[],
    cohortClassGroupIds: string[] | null,
    bandsByInstrument: Map<string, PerformanceBandInput[]>,
  ): Promise<StudentSubjectComparison> {
    const anchor = this.pickAnchor(group);
    const comparability = buildComparabilityMeta(uniqueInstrumentRefs(group), group.length);
    const anchorBands = await this.bandsFor(tx, anchor.instrumentId, bandsByInstrument);
    const student = this.buildStudentSlice(anchor, anchorBands);

    const anchorCourses = await this.loadGradeCourses(
      tx,
      orgId,
      anchor.instrumentId,
      cohortClassGroupIds,
      anchorBands,
    );
    const studentCourseId = await this.resolveStudentCourseId(
      tx,
      orgId,
      studentId,
      anchor.gradeId,
      anchor.year,
    );

    const course = this.courseCohort(anchorCourses.courses, studentCourseId, student.achievement);
    const grade = this.gradeCohort(anchorCourses, student.achievement);
    const generations = await this.generationCohorts(
      tx,
      orgId,
      anchor,
      cohortClassGroupIds,
      student.achievement,
      bandsByInstrument,
    );

    return {
      subjectId: anchor.subjectId,
      subjectName: anchor.subjectName,
      anchor: anchor.ref,
      student,
      course,
      grade,
      generations,
      comparability,
    };
  }

  private pickAnchor(group: StudentPanoramaAssessment[]): Anchor {
    const chosen = [...group].sort(compareAnchorPreference)[0]!;
    return {
      instrumentId: chosen.instrumentId,
      instrumentType: chosen.instrumentType,
      subjectId: chosen.subjectId,
      subjectName: chosen.subjectName,
      gradeId: chosen.gradeId,
      year: chosen.year,
      applicationPeriod: chosen.applicationPeriod,
      trackId: chosen.trackId,
      achievement: chosen.achievement,
      performanceBand: chosen.performanceBand,
      performanceLevel: chosen.performanceLevel,
      ref: {
        instrumentId: chosen.instrumentId,
        instrumentName: chosen.instrumentName,
        year: chosen.year,
        applicationPeriod: chosen.applicationPeriod,
        label: anchorLabel(chosen.year, chosen.applicationPeriod),
      },
    };
  }

  private buildStudentSlice(
    anchor: Anchor,
    bands: PerformanceBandInput[],
  ): StudentSubjectComparison['student'] {
    if (anchor.performanceBand !== null || anchor.achievement === null) {
      return {
        achievement: anchor.achievement,
        performanceBand: anchor.performanceBand,
        performanceLevel: anchor.performanceLevel,
      };
    }
    const band = bands.length > 0 ? classifyByBands(anchor.achievement / 100, bands) : null;
    if (!band) {
      return {
        achievement: anchor.achievement,
        performanceBand: null,
        performanceLevel: anchor.performanceLevel,
      };
    }
    return {
      achievement: anchor.achievement,
      performanceBand: bandInputToView(band),
      performanceLevel: bandToLegacyLevel(band, bands),
    };
  }

  private courseCohort(
    courses: ComparableUnitClassGroup[],
    studentCourseId: string | null,
    studentAchievement: number | null,
  ): CohortStat | null {
    const course = studentCourseId
      ? courses.find((c) => c.classGroupId === studentCourseId)
      : undefined;
    if (!course) return null;
    return {
      label: course.classGroupName,
      achievement: course.averageAchievement,
      studentsAssessed: course.studentsAssessed,
      deltaPp: deltaInPoints(studentAchievement, course.averageAchievement),
    };
  }

  private gradeCohort(
    gradeCourses: GradeCourses,
    studentAchievement: number | null,
  ): CohortStat | null {
    if (gradeCourses.courses.length === 0) return null;
    const folded = foldCourses(gradeCourses);
    return {
      label: gradeLabelOf(gradeCourses.courses),
      achievement: folded.achievement,
      studentsAssessed: folded.students,
      deltaPp: deltaInPoints(studentAchievement, folded.achievement),
    };
  }

  private async generationCohorts(
    tx: Database,
    orgId: string,
    anchor: Anchor,
    cohortClassGroupIds: string[] | null,
    studentAchievement: number | null,
    bandsByInstrument: Map<string, PerformanceBandInput[]>,
  ): Promise<CohortStat[]> {
    const anchorYear = anchor.year;
    if (anchorYear === null) return [];

    const familyKey = buildInstrumentFamilyKey(anchorFamilyRef(anchor));
    const family = await this.loadFamilyInstruments(tx, orgId, anchor.instrumentType);
    const previousByYear = new Map<number, FamilyInstrument[]>();
    for (const instrument of family) {
      if (instrument.year >= anchorYear) continue;
      if (buildInstrumentFamilyKey(instrument.ref) !== familyKey) continue;
      const bucket = previousByYear.get(instrument.year);
      if (bucket) bucket.push(instrument);
      else previousByYear.set(instrument.year, [instrument]);
    }

    const years = [...previousByYear.keys()].sort((a, b) => b - a);
    const generations: CohortStat[] = [];
    for (const year of years) {
      const cohortTally = emptyTally();
      let cohortStudents = 0;
      for (const instrument of previousByYear.get(year)!) {
        const bands = await this.bandsFor(tx, instrument.instrumentId, bandsByInstrument);
        const courses = await this.loadGradeCourses(
          tx,
          orgId,
          instrument.instrumentId,
          cohortClassGroupIds,
          bands,
        );
        const folded = foldCourses(courses);
        cohortStudents += folded.students;
        addTally(cohortTally, folded.tally);
      }
      const achievement = achievementPct(cohortTally);
      generations.push({
        label: String(year),
        achievement,
        studentsAssessed: cohortStudents,
        deltaPp: deltaInPoints(studentAchievement, achievement),
      });
    }
    return generations;
  }

  private async loadGradeCourses(
    tx: Database,
    orgId: string,
    instrumentId: string,
    cohortClassGroupIds: string[] | null,
    bands: PerformanceBandInput[],
  ): Promise<GradeCourses> {
    const assessmentIds = await this.loadAssessmentIds(tx, orgId, instrumentId);
    if (assessmentIds.length === 0) return { courses: [], tallies: new Map() };
    const courses = await this.assembler.loadByClassGroup(
      tx,
      orgId,
      assessmentIds,
      cohortClassGroupIds,
      bands,
    );
    const tallies = await this.loadCourseTallies(
      tx,
      assessmentIds,
      courses.map((c) => c.classGroupId),
    );
    return { courses, tallies };
  }

  private async loadCourseTallies(
    tx: Database,
    assessmentIds: string[],
    classGroupIds: string[],
  ): Promise<Map<string, AchievementTally>> {
    const tallies = new Map<string, AchievementTally>();
    if (classGroupIds.length === 0) return tallies;
    const rows = await tx
      .select({
        classGroupId: assessmentItemStats.classGroupId,
        scoreSum: sql<string>`coalesce(sum(${assessmentItemStats.scoreSum}), 0)`,
        maxSum: sql<string>`coalesce(sum(${assessmentItemStats.maxSum}), 0)`,
      })
      .from(assessmentItemStats)
      .innerJoin(assessments, eq(assessments.id, assessmentItemStats.assessmentId))
      .where(
        and(
          inArray(assessmentItemStats.assessmentId, assessmentIds),
          inArray(assessmentItemStats.classGroupId, classGroupIds),
          preferComputedOverImported(assessmentItemStats),
        ),
      )
      .groupBy(assessmentItemStats.classGroupId);
    for (const row of rows) tallies.set(row.classGroupId, tallyOf([row]));
    return tallies;
  }

  private async loadAssessmentIds(
    tx: Database,
    orgId: string,
    instrumentId: string,
  ): Promise<string[]> {
    const rows = await tx
      .select({ id: assessments.id })
      .from(assessments)
      .where(and(eq(assessments.orgId, orgId), eq(assessments.instrumentId, instrumentId)));
    return rows.map((r) => r.id);
  }

  private async loadFamilyInstruments(
    tx: Database,
    orgId: string,
    type: string,
  ): Promise<FamilyInstrument[]> {
    const rows = await tx
      .selectDistinct({
        instrumentId: instruments.id,
        type: instruments.type,
        subjectId: instruments.subjectId,
        gradeId: instruments.gradeId,
        applicationPeriod: instruments.applicationPeriod,
        year: instruments.year,
        trackId: instruments.trackId,
      })
      .from(instruments)
      .innerJoin(assessments, eq(assessments.instrumentId, instruments.id))
      .where(
        and(
          eq(assessments.orgId, orgId),
          sql`${instruments.type}::text = ${type}`,
          isNull(instruments.deletedAt),
        ),
      );

    const family: FamilyInstrument[] = [];
    for (const row of rows) {
      if (row.year === null) continue;
      family.push({
        instrumentId: row.instrumentId,
        year: row.year,
        ref: {
          instrumentId: row.instrumentId,
          type: row.type,
          subjectId: row.subjectId,
          gradeId: row.gradeId,
          applicationPeriod: row.applicationPeriod,
          year: row.year,
          trackId: row.trackId,
        },
      });
    }
    return family;
  }

  private async resolveStudentCourseId(
    tx: Database,
    orgId: string,
    studentId: string,
    gradeId: string | null,
    year: number | null,
  ): Promise<string | null> {
    const conditions = [eq(studentEnrollments.studentId, studentId), eq(classGroups.orgId, orgId)];
    if (gradeId !== null) conditions.push(eq(classGroups.gradeId, gradeId));
    if (year !== null) conditions.push(eq(academicYears.year, year));

    const [row] = await tx
      .select({ classGroupId: classGroups.id })
      .from(studentEnrollments)
      .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
      .innerJoin(academicYears, eq(academicYears.id, classGroups.academicYearId))
      .where(and(...conditions))
      .limit(1);
    return row?.classGroupId ?? null;
  }

  private async bandsFor(
    tx: Database,
    instrumentId: string,
    cache: Map<string, PerformanceBandInput[]>,
  ): Promise<PerformanceBandInput[]> {
    const cached = cache.get(instrumentId);
    if (cached) return cached;
    const { bands } = await resolveEffectiveBands(tx, instrumentId);
    cache.set(instrumentId, bands);
    return bands;
  }

  private groupBySubject(rows: StudentPanoramaAssessment[]): StudentPanoramaAssessment[][] {
    const grouped = new Map<string, StudentPanoramaAssessment[]>();
    for (const row of rows) {
      const key = row.subjectId ?? '';
      const bucket = grouped.get(key);
      if (bucket) bucket.push(row);
      else grouped.set(key, [row]);
    }
    return [...grouped.values()];
  }

  private resolveFilters(
    query: StudentComparisonsQueryDto,
    rows: StudentPanoramaAssessment[],
  ): ResolvedFilters {
    const allYears = query.allYears === true;
    const declaredYears = rows.map((r) => r.year).filter((y): y is number => y !== null);
    const latestYear = declaredYears.length > 0 ? Math.max(...declaredYears) : null;
    const year = allYears ? null : (query.year ?? latestYear);
    return {
      subjectId: query.subjectId ?? null,
      instrumentType: query.instrumentType ?? null,
      applicationPeriod: query.applicationPeriod ?? null,
      year,
    };
  }

  private applyFilters(
    rows: StudentPanoramaAssessment[],
    filters: ResolvedFilters,
  ): StudentPanoramaAssessment[] {
    return rows.filter((row) => {
      if (filters.subjectId !== null && row.subjectId !== filters.subjectId) return false;
      if (filters.instrumentType !== null && row.instrumentType !== filters.instrumentType) {
        return false;
      }
      if (
        filters.applicationPeriod !== null &&
        row.applicationPeriod !== filters.applicationPeriod
      ) {
        return false;
      }
      if (filters.year !== null && row.year !== null && row.year !== filters.year) return false;
      return true;
    });
  }
}

function bandInputToView(band: PerformanceBandInput): PerformanceBandView {
  return { key: band.key, label: band.label, order: band.order, color: band.color ?? null };
}

function anchorFamilyRef(anchor: Anchor): ComparabilityInstrumentRef {
  return {
    instrumentId: anchor.instrumentId,
    type: anchor.instrumentType,
    subjectId: anchor.subjectId,
    gradeId: anchor.gradeId,
    applicationPeriod: anchor.applicationPeriod,
    year: anchor.year,
    trackId: anchor.trackId,
  };
}

function periodRank(period: InstrumentApplicationPeriod | null): number {
  if (!period) return -1;
  return INSTRUMENT_APPLICATION_PERIODS.indexOf(period);
}

function compareAnchorPreference(
  a: StudentPanoramaAssessment,
  b: StudentPanoramaAssessment,
): number {
  const yearA = a.year ?? -Infinity;
  const yearB = b.year ?? -Infinity;
  if (yearA !== yearB) return yearB - yearA;
  const periodDiff = periodRank(b.applicationPeriod) - periodRank(a.applicationPeriod);
  if (periodDiff !== 0) return periodDiff;
  return dateValue(b.administeredAt) - dateValue(a.administeredAt);
}

function dateValue(value: string | Date | null): number {
  if (value === null) return -Infinity;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? -Infinity : time;
}

function anchorLabel(year: number | null, period: InstrumentApplicationPeriod | null): string {
  const periodLabel = period ? INSTRUMENT_APPLICATION_PERIOD_LABELS[period] : null;
  if (year === null) return periodLabel ?? 'Sin período';
  return periodLabel ? `${periodLabel} ${year}` : String(year);
}

function foldCourses({ courses, tallies }: GradeCourses): {
  achievement: number | null;
  tally: AchievementTally;
  students: number;
} {
  const tally = emptyTally();
  let students = 0;
  for (const course of courses) {
    students += course.studentsAssessed;
    const courseTally = tallies.get(course.classGroupId);
    if (courseTally) addTally(tally, courseTally);
  }
  return { achievement: achievementPct(tally), tally, students };
}

function gradeLabelOf(courses: ComparableUnitClassGroup[]): string {
  for (const course of courses) {
    if (course.gradeName) return course.gradeName;
  }
  return 'Nivel completo';
}

function uniqueInstrumentRefs(rows: StudentPanoramaAssessment[]): ComparabilityInstrumentRef[] {
  const byId = new Map<string, ComparabilityInstrumentRef>();
  for (const row of rows) {
    if (byId.has(row.instrumentId)) continue;
    byId.set(row.instrumentId, {
      instrumentId: row.instrumentId,
      type: row.instrumentType,
      subjectId: row.subjectId,
      gradeId: row.gradeId,
      applicationPeriod: row.applicationPeriod,
      year: row.year,
      trackId: row.trackId,
    });
  }
  return [...byId.values()];
}
