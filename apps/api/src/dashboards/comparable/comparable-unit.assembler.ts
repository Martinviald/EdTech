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
  buildInstrumentFamilyKey,
  buildPeriodSeriesKey,
  classifyByBands,
  previousApplicationPeriod,
  type ComparabilityInstrumentRef,
  type ComparableUnitClassGroup,
  type PerformanceBandDistributionBucket,
  type PerformanceBandInput,
} from '@soe/types';
import { loadCohortAchievementByAssessment } from '../../common/helpers/cohort-item-stats.helper';
import {
  levelCountsToBandDistribution,
  loadCohortLevelCounts,
} from '../../common/helpers/cohort-level-stats.helper';
import type { Database } from '../../database/database.types';

export type AchievementByAssessment = Map<string, { achievement: number | null; students: number }>;

export type BaselineCandidate = {
  instrumentId: string;
  label: string;
  assessmentIds: string[];
};

/**
 * Arma UNA unidad comparable a partir de sus evaluaciones: % de logro (ponderado por
 * alumnos), distribución por bandas del instrumento, desglose por curso y sus baselines.
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
  /**
   * % de logro por evaluación, por el primer camino con datos: primero el promedio real
   * por alumno (`assessment_results`), y como respaldo el read-model de cohorte —lo único
   * que hay cuando la evaluación vino de un informe oficial agregado.
   */
  async loadAchievementByAssessment(
    tx: Database,
    assessmentIds: string[],
    classGroupIds: string[] | null,
  ): Promise<AchievementByAssessment> {
    if (assessmentIds.length === 0) return new Map();

    const perStudent = await tx
      .select({
        assessmentId: assessmentResults.assessmentId,
        avgPct: sql<string | null>`avg(${assessmentResults.percentage}::numeric)`,
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
        achievement: row.avgPct == null ? null : Number(row.avgPct),
        students: Number(row.students ?? 0),
      });
    }

    const cohort = await loadCohortAchievementByAssessment(tx, assessmentIds, classGroupIds);
    for (const row of cohort) {
      const existing = byAssessment.get(row.assessmentId);
      if (existing && existing.achievement != null) continue;
      byAssessment.set(row.assessmentId, {
        achievement: row.averageAchievement,
        students: existing?.students || row.studentsAssessed,
      });
    }
    return byAssessment;
  }

  /** Promedio ponderado por alumnos sobre las evaluaciones de una unidad. */
  foldAchievement(
    assessmentIds: string[],
    byAssessment: AchievementByAssessment,
  ): { achievement: number | null; students: number } {
    let weighted = 0;
    let weight = 0;
    let students = 0;
    for (const id of assessmentIds) {
      const row = byAssessment.get(id);
      if (!row) continue;
      students += row.students;
      if (row.achievement == null || row.students === 0) continue;
      weighted += row.achievement * row.students;
      weight += row.students;
    }
    return { achievement: weight > 0 ? weighted / weight : null, students };
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
        performanceBandId: assessmentResults.performanceBandId,
        percentage: assessmentResults.percentage,
      })
      .from(assessmentResults)
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .where(
        and(inArray(assessmentResults.assessmentId, assessmentIds), isNull(students.deletedAt)),
      );

    const counts = new Map<string, number>();
    for (const row of rows) {
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

  /** Desglose por curso de una unidad, ordenado por logro ascendente. */
  async loadByClassGroup(
    tx: Database,
    orgId: string,
    assessmentIds: string[],
    classGroupIds: string[] | null,
    bands: PerformanceBandInput[],
  ): Promise<ComparableUnitClassGroup[]> {
    if (assessmentIds.length === 0) return [];

    const conditions = [
      inArray(assessmentResults.assessmentId, assessmentIds),
      eq(classGroups.orgId, orgId),
      isNull(students.deletedAt),
    ];
    if (classGroupIds !== null) {
      if (classGroupIds.length === 0) return [];
      conditions.push(inArray(classGroups.id, classGroupIds));
    }

    const rows = await tx
      .select({
        classGroupId: classGroups.id,
        classGroupName: classGroups.name,
        gradeName: grades.name,
        percentage: assessmentResults.percentage,
        performanceBandId: assessmentResults.performanceBandId,
        studentId: assessmentResults.studentId,
      })
      .from(assessmentResults)
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .innerJoin(studentEnrollments, eq(studentEnrollments.studentId, assessmentResults.studentId))
      .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
      .leftJoin(grades, eq(grades.id, classGroups.gradeId))
      .where(and(...conditions));

    const lowestBandId = bands.length > 0 ? lowestBand(bands)?.id : undefined;

    type Acc = {
      classGroupId: string;
      classGroupName: string;
      gradeName: string | null;
      pctSum: number;
      pctCount: number;
      studentIds: Set<string>;
      inLowestBand: number;
      classified: number;
    };
    const byCourse = new Map<string, Acc>();
    for (const row of rows) {
      let acc = byCourse.get(row.classGroupId);
      if (!acc) {
        acc = {
          classGroupId: row.classGroupId,
          classGroupName: row.classGroupName,
          gradeName: row.gradeName,
          pctSum: 0,
          pctCount: 0,
          studentIds: new Set(),
          inLowestBand: 0,
          classified: 0,
        };
        byCourse.set(row.classGroupId, acc);
      }
      acc.studentIds.add(row.studentId);
      if (row.percentage != null) {
        acc.pctSum += Number(row.percentage);
        acc.pctCount += 1;
      }
      if (lowestBandId) {
        const bandId = row.performanceBandId ?? this.classifyPercentage(row.percentage, bands);
        if (bandId) {
          acc.classified += 1;
          if (bandId === lowestBandId) acc.inLowestBand += 1;
        }
      }
    }

    return Array.from(byCourse.values())
      .map((acc) => ({
        classGroupId: acc.classGroupId,
        classGroupName: acc.classGroupName,
        gradeName: acc.gradeName,
        studentsAssessed: acc.studentIds.size,
        averageAchievement: acc.pctCount > 0 ? acc.pctSum / acc.pctCount : null,
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
