import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  assessmentResults,
  assessments,
  classGroups,
  grades,
  instruments,
  studentEnrollments,
  students,
} from '@soe/db';
import {
  achievementPct,
  addTally,
  emptyTally,
  tallyOf,
  buildInstrumentFamilyKey,
  buildPeriodSeriesKey,
  classifyByBands,
  previousApplicationPeriod,
  type AchievementTally,
  type ComparabilityInstrumentRef,
  type ComparableUnitClassGroup,
  type PerformanceBandDistributionBucket,
  type PerformanceBandInput,
} from '@soe/types';
import {
  assessmentAcademicYears,
  scopedAssessmentResults,
} from '../../common/helpers/assessment-academic-year.helper';
import { loadCohortAchievementByAssessment } from '../../common/helpers/cohort-item-stats.helper';
import {
  levelCountsToBandDistribution,
  loadCohortLevelCounts,
  loadCohortLevelCountsByAssessment,
  type CohortLevelCount,
} from '../../common/helpers/cohort-level-stats.helper';
import type { Database } from '../../database/database.types';

export type AchievementByAssessment = Map<string, { tally: AchievementTally; students: number }>;

export type ClassGroupTotalsRow = {
  instrumentId: string;
  classGroupId: string;
  classGroupName: string;
  gradeName: string | null;
  studentsAssessed: number;
  scoreSum: string | null;
  maxSum: string | null;
};

export type ClassGroupClassificationRow = {
  instrumentId: string;
  classGroupId: string;
  performanceBandId: string | null;
  percentage: string | null;
  count: number;
};

export type ClassGroupBreakdownData = {
  totals: ClassGroupTotalsRow[];
  classification: ClassGroupClassificationRow[];
};

export type BandClassificationRow = {
  assessmentId: string;
  performanceBandId: string | null;
  percentage: string | null;
};

export type BaselineCandidate = {
  instrumentId: string;
  label: string;
  assessmentIds: string[];
};

/**
 * Arma UNA unidad comparable a partir de sus evaluaciones: % de logro, distribución por
 * bandas del instrumento, desglose por curso y sus baselines.
 *
 * Vive aquí —y no como métodos privados de `ComparableOverviewService`— porque lo reusan
 * dos orquestadores distintos: `ComparableOverviewService` (la matriz de muchas unidades)
 * y `ComparableTrajectoryService` (una unidad a lo largo del tiempo). Es el punto único
 * donde vive el cómputo correcto de una unidad; ninguno de los dos re-deriva un promedio
 * crudo por su cuenta (`03-helpers-vs-services.md`: lógica reusada entre archivos → su
 * propio servicio).
 */
@Injectable()
export class ComparableUnitAssembler {
  async loadAchievementByAssessment(
    tx: Database,
    assessmentIds: string[],
    classGroupIds: string[] | null,
  ): Promise<AchievementByAssessment> {
    if (assessmentIds.length === 0) return new Map();

    const perStudent = await tx
      .select({
        assessmentId: assessmentResults.assessmentId,
        scoreSum: sql<string>`coalesce(sum(${assessmentResults.totalScore}), 0)`,
        maxSum: sql<string>`coalesce(sum(${assessmentResults.maxScore}), 0)`,
        students: sql<number>`count(distinct ${assessmentResults.studentId})::int`,
      })
      .from(assessmentResults)
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .where(
        and(inArray(assessmentResults.assessmentId, assessmentIds), isNull(students.deletedAt)),
      )
      .groupBy(assessmentResults.assessmentId);

    const byAssessment: AchievementByAssessment = new Map();
    for (const row of perStudent) {
      byAssessment.set(row.assessmentId, {
        tally: tallyOf([row]),
        students: Number(row.students ?? 0),
      });
    }

    const cohort = await loadCohortAchievementByAssessment(tx, assessmentIds, classGroupIds);
    for (const row of cohort) {
      const existing = byAssessment.get(row.assessmentId);
      if (existing && existing.tally.maxSum > 0) continue;
      byAssessment.set(row.assessmentId, {
        tally: { scoreSum: row.scoreSum, maxSum: row.maxSum },
        students: existing?.students || row.studentsAssessed,
      });
    }
    return byAssessment;
  }

  foldAchievement(
    assessmentIds: string[],
    byAssessment: AchievementByAssessment,
  ): { achievement: number | null; students: number } {
    const tally = emptyTally();
    let students = 0;
    for (const id of assessmentIds) {
      const row = byAssessment.get(id);
      if (!row) continue;
      students += row.students;
      addTally(tally, row.tally);
    }
    return { achievement: achievementPct(tally), students };
  }

  /**
   * Distribución por banda de la unidad, por el primer camino que tenga datos:
   *
   *  1. `assessment_level_stats` — el read-model de cohorte, único disponible cuando la
   *     evaluación vino de un informe oficial agregado.
   *  2. `assessment_results.performance_band_id` — la banda ya escrita por alumno.
   *  3. El `percentage` de cada alumno clasificado con las bandas DEL INSTRUMENTO.
   */
  async resolveBandDistribution(
    tx: Database,
    assessmentIds: string[],
    classGroupIds: string[] | null,
    bands: PerformanceBandInput[],
  ): Promise<PerformanceBandDistributionBucket[] | null> {
    const cohortCounts = await this.loadUnitLevelCounts(tx, assessmentIds, classGroupIds);
    if (cohortCounts.length > 0) return levelCountsToBandDistribution(cohortCounts, bands);

    const rows = await tx
      .select({
        assessmentId: assessmentResults.assessmentId,
        performanceBandId: assessmentResults.performanceBandId,
        percentage: assessmentResults.percentage,
      })
      .from(assessmentResults)
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .where(
        and(inArray(assessmentResults.assessmentId, assessmentIds), isNull(students.deletedAt)),
      );

    return this.foldBandDistribution(cohortCounts, rows, bands);
  }

  /**
   * Las filas por alumno de VARIAS evaluaciones en una query, para el camino de
   * respaldo de la distribución por banda.
   */
  async loadBandClassificationRows(
    tx: Database,
    assessmentIds: string[],
  ): Promise<Map<string, BandClassificationRow[]>> {
    const byAssessment = new Map<string, BandClassificationRow[]>();
    if (assessmentIds.length === 0) return byAssessment;

    const rows = await tx
      .select({
        assessmentId: assessmentResults.assessmentId,
        performanceBandId: assessmentResults.performanceBandId,
        percentage: assessmentResults.percentage,
      })
      .from(assessmentResults)
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .where(
        and(inArray(assessmentResults.assessmentId, assessmentIds), isNull(students.deletedAt)),
      );

    for (const row of rows) {
      const bucket = byAssessment.get(row.assessmentId);
      if (bucket) bucket.push(row);
      else byAssessment.set(row.assessmentId, [row]);
    }
    return byAssessment;
  }

  /** El cómputo de la distribución, ya sin consultar: primero cohorte, después alumnos. */
  foldBandDistribution(
    cohortCounts: readonly CohortLevelCount[],
    classificationRows: readonly BandClassificationRow[],
    bands: PerformanceBandInput[],
  ): PerformanceBandDistributionBucket[] | null {
    if (cohortCounts.length > 0) return levelCountsToBandDistribution(cohortCounts, bands);

    const counts = new Map<string, number>();
    for (const row of classificationRows) {
      const bandId = row.performanceBandId ?? this.classifyPercentage(row.percentage, bands);
      if (!bandId) continue;
      counts.set(bandId, (counts.get(bandId) ?? 0) + 1);
    }
    if (counts.size === 0) return null;

    return levelCountsToBandDistribution(
      Array.from(counts.entries()).map(([performanceBandId, count]) => ({
        performanceBandId,
        count,
      })),
      bands,
    );
  }

  /** Conteos por banda de todas las evaluaciones del alcance, en una query. */
  loadLevelCountsByAssessment(
    tx: Database,
    assessmentIds: string[],
    classGroupIds: string[] | null,
  ): Promise<Map<string, CohortLevelCount[]>> {
    return loadCohortLevelCountsByAssessment(tx, assessmentIds, classGroupIds);
  }

  /** Suma los conteos de cohorte de las evaluaciones de una unidad. */
  foldLevelCounts(
    assessmentIds: string[],
    byAssessment: Map<string, CohortLevelCount[]>,
  ): CohortLevelCount[] {
    const counts = new Map<string, number>();
    for (const assessmentId of assessmentIds) {
      for (const row of byAssessment.get(assessmentId) ?? []) {
        counts.set(row.performanceBandId, (counts.get(row.performanceBandId) ?? 0) + row.count);
      }
    }
    return Array.from(counts.entries()).map(([performanceBandId, count]) => ({
      performanceBandId,
      count,
    }));
  }

  /** % de alumnos en la banda inferior de una distribución ya resuelta. */
  lowestBandShare(distribution: { order: number; percentage: number }[] | null): number | null {
    if (!distribution || distribution.length === 0) return null;
    const lowest = distribution.reduce((min, b) => (b.order < min.order ? b : min));
    return lowest.percentage;
  }

  private classifyPercentage(
    percentage: string | null,
    bands: PerformanceBandInput[],
  ): string | null {
    if (percentage == null) return null;
    const band = classifyByBands(Number(percentage) / 100, bands);
    return band?.id ?? null;
  }

  private async loadUnitLevelCounts(
    tx: Database,
    assessmentIds: string[],
    classGroupIds: string[] | null,
  ) {
    const counts = new Map<string, number>();
    for (const assessmentId of assessmentIds) {
      const rows = await loadCohortLevelCounts(tx, assessmentId, classGroupIds);
      for (const row of rows) {
        counts.set(row.performanceBandId, (counts.get(row.performanceBandId) ?? 0) + row.count);
      }
    }
    return Array.from(counts.entries()).map(([performanceBandId, count]) => ({
      performanceBandId,
      count,
    }));
  }

  /**
   * Desglose por curso de una unidad, ordenado por logro ascendente.
   *
   * La matrícula se une por el AÑO de la evaluación: `student_enrollments` es única
   * por (alumno, año), así que unir sólo por alumno traía una fila por cada año
   * cursado —el mismo alumno contado en 3° y en 4° Medio—. Medido en la demo: 2.164 filas
   * para 1.082 resultados.
   */
  async loadByClassGroup(
    tx: Database,
    orgId: string,
    assessmentIds: string[],
    classGroupIds: string[] | null,
    bands: PerformanceBandInput[],
  ): Promise<ComparableUnitClassGroup[]> {
    const data = await this.loadClassGroupBreakdown(tx, orgId, assessmentIds, classGroupIds, {
      needsClassification: bands.length > 0,
    });
    return this.foldByClassGroup(data, bands);
  }

  /**
   * El desglose por curso, agregado por Postgres.
   *
   * Son tres consultas y no una porque la clasificación en bandas NO se puede empujar
   * a SQL sin duplicar la regla, que vive en `classifyByBands` (`@soe/types`): los
   * totales por curso y los conteos de las filas que YA traen banda se agregan en la
   * base, y sólo las filas sin banda viajan —su porcentaje, nada más— para que la
   * regla las clasifique donde está escrita una sola vez.
   */
  async loadClassGroupBreakdown(
    tx: Database,
    orgId: string,
    assessmentIds: string[],
    classGroupIds: string[] | null,
    options: { needsClassification: boolean } = { needsClassification: true },
  ): Promise<ClassGroupBreakdownData> {
    const empty: ClassGroupBreakdownData = { totals: [], classification: [] };
    if (assessmentIds.length === 0) return empty;
    if (classGroupIds !== null && classGroupIds.length === 0) return empty;

    const conditions = [eq(classGroups.orgId, orgId)];
    if (classGroupIds !== null) conditions.push(inArray(classGroups.id, classGroupIds));

    const scoped = scopedAssessmentResults(tx, assessmentIds);
    const assessmentYear = assessmentAcademicYears(tx);
    const enrollmentOfAssessmentYear = and(
      eq(studentEnrollments.studentId, scoped.studentId),
      eq(studentEnrollments.academicYearId, assessmentYear.academicYearId),
    );

    const totalsQuery = tx
      .select({
        instrumentId: scoped.instrumentId,
        classGroupId: classGroups.id,
        classGroupName: classGroups.name,
        gradeName: grades.name,
        studentsAssessed: sql<number>`count(distinct ${scoped.studentId})::int`,
        scoreSum: sql<string>`coalesce(sum(${scoped.totalScore}), 0)`,
        maxSum: sql<string>`coalesce(sum(${scoped.maxScore}), 0)`,
      })
      .from(scoped)
      .innerJoin(assessmentYear, eq(assessmentYear.assessmentId, scoped.assessmentId))
      .innerJoin(studentEnrollments, enrollmentOfAssessmentYear)
      .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
      .leftJoin(grades, eq(grades.id, classGroups.gradeId))
      .where(and(...conditions))
      .groupBy(scoped.instrumentId, classGroups.id, classGroups.name, grades.name);

    const classificationQuery = tx
      .select({
        instrumentId: scoped.instrumentId,
        classGroupId: classGroups.id,
        performanceBandId: scoped.performanceBandId,
        percentage: scoped.percentage,
        count: sql<number>`count(*)::int`,
      })
      .from(scoped)
      .innerJoin(assessmentYear, eq(assessmentYear.assessmentId, scoped.assessmentId))
      .innerJoin(studentEnrollments, enrollmentOfAssessmentYear)
      .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
      .where(and(...conditions))
      .groupBy(scoped.instrumentId, classGroups.id, scoped.performanceBandId, scoped.percentage);

    const [totals, classification] = await Promise.all([
      totalsQuery,
      options.needsClassification ? classificationQuery : Promise.resolve([]),
    ]);

    return { totals, classification };
  }

  /** Arma los cursos con lo que Postgres ya agregó. Sin consultar. */
  foldByClassGroup(
    data: ClassGroupBreakdownData,
    bands: PerformanceBandInput[],
  ): ComparableUnitClassGroup[] {
    const lowestBandId = bands.length > 0 ? lowestBand(bands)?.id : undefined;

    type Acc = {
      classGroupId: string;
      classGroupName: string;
      gradeName: string | null;
      studentsAssessed: number;
      tally: AchievementTally;
      inLowestBand: number;
      classified: number;
    };
    const byCourse = new Map<string, Acc>();
    for (const row of data.totals) {
      const existing = byCourse.get(row.classGroupId);
      const acc = existing ?? {
        classGroupId: row.classGroupId,
        classGroupName: row.classGroupName,
        gradeName: row.gradeName,
        studentsAssessed: 0,
        tally: emptyTally(),
        inLowestBand: 0,
        classified: 0,
      };
      acc.studentsAssessed += row.studentsAssessed;
      addTally(acc.tally, tallyOf([row]));
      if (!existing) byCourse.set(row.classGroupId, acc);
    }

    if (lowestBandId) {
      for (const row of data.classification) {
        const acc = byCourse.get(row.classGroupId);
        if (!acc) continue;
        const bandId = row.performanceBandId ?? this.classifyPercentage(row.percentage, bands);
        if (!bandId) continue;
        acc.classified += row.count;
        if (bandId === lowestBandId) acc.inLowestBand += row.count;
      }
    }

    return Array.from(byCourse.values())
      .map((acc) => ({
        classGroupId: acc.classGroupId,
        classGroupName: acc.classGroupName,
        gradeName: acc.gradeName,
        studentsAssessed: acc.studentsAssessed,
        averageAchievement: achievementPct(acc.tally),
        lowestBandShare: acc.classified > 0 ? (acc.inLowestBand / acc.classified) * 100 : null,
      }))
      .sort((a, b) => (a.averageAchievement ?? 101) - (b.averageAchievement ?? 101));
  }

  /**
   * Candidatos de baseline del alcance: todas las aplicaciones de los tipos presentes,
   * indexadas por clave de familia N2 (`familyKey::year`) y de serie de momentos N3
   * (`seriesKey::period`). Un solo barrido; luego `resolveBaselineChoices` elige.
   */
  async loadBaselineCandidates(
    tx: Database,
    orgId: string,
    refs: ComparabilityInstrumentRef[],
  ): Promise<Map<string, BaselineCandidate>> {
    const types = Array.from(new Set(refs.map((r) => r.type)));
    if (types.length === 0) return new Map();

    const rows = await tx
      .select({
        assessmentId: assessments.id,
        instrumentId: instruments.id,
        instrumentName: instruments.name,
        type: instruments.type,
        subjectId: instruments.subjectId,
        gradeId: instruments.gradeId,
        applicationPeriod: instruments.applicationPeriod,
        year: instruments.year,
        trackId: instruments.trackId,
      })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .where(
        and(
          eq(assessments.orgId, orgId),
          isNull(instruments.deletedAt),
          inArray(sql`${instruments.type}::text`, types),
        ),
      );

    const byKey = new Map<string, BaselineCandidate>();
    for (const row of rows) {
      const ref: ComparabilityInstrumentRef = {
        instrumentId: row.instrumentId,
        type: row.type,
        subjectId: row.subjectId,
        gradeId: row.gradeId,
        applicationPeriod: row.applicationPeriod,
        year: row.year,
        trackId: row.trackId,
      };
      const familyKey = `${buildInstrumentFamilyKey(ref)}::${row.year ?? 0}`;
      const seriesKey = `${buildPeriodSeriesKey(ref)}::${row.applicationPeriod ?? '-'}`;
      for (const key of [familyKey, seriesKey]) {
        const existing = byKey.get(key);
        if (existing) {
          existing.assessmentIds.push(row.assessmentId);
          continue;
        }
        byKey.set(key, {
          instrumentId: row.instrumentId,
          label: row.instrumentName,
          assessmentIds: [row.assessmentId],
        });
      }
    }
    return byKey;
  }

  /**
   * Los dos comparables de una unidad: el momento anterior del ciclo (N3) y la misma
   * familia el año anterior (N2). Cualquiera puede faltar.
   */
  resolveBaselineChoices(
    ref: ComparabilityInstrumentRef,
    candidates: Map<string, BaselineCandidate>,
  ): { previousPeriod: BaselineCandidate | null; previousYear: BaselineCandidate | null } {
    const previousYear =
      candidates.get(`${buildInstrumentFamilyKey(ref)}::${(ref.year ?? 0) - 1}`) ?? null;
    const previousPeriodKey = previousApplicationPeriod(ref.applicationPeriod);
    const previousPeriod = previousPeriodKey
      ? (candidates.get(`${buildPeriodSeriesKey(ref)}::${previousPeriodKey}`) ?? null)
      : null;
    return { previousPeriod, previousYear };
  }

  /** % de logro de un conjunto de evaluaciones (para un baseline). */
  async baselineAchievement(
    tx: Database,
    assessmentIds: string[],
    classGroupIds: string[] | null,
  ): Promise<number | null> {
    const byAssessment = await this.loadAchievementByAssessment(tx, assessmentIds, classGroupIds);
    return this.foldAchievement(assessmentIds, byAssessment).achievement;
  }
}

function lowestBand(bands: PerformanceBandInput[]): PerformanceBandInput | undefined {
  return bands.reduce<PerformanceBandInput | undefined>(
    (min, b) => (min === undefined || b.order < min.order ? b : min),
    undefined,
  );
}
