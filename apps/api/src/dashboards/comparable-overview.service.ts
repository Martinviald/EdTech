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
  subjects,
  withOrgContext,
} from '@soe/db';
import {
  buildComparabilityMeta,
  buildInstrumentFamilyKey,
  classifyByBands,
  buildPeriodSeriesKey,
  compareSeverity,
  deltaInPoints,
  previousApplicationPeriod,
  severityFromLowestBandShare,
  type BaselineRef,
  type ComparabilityInstrumentRef,
  type ComparableOverviewQueryDto,
  type ComparableOverviewResponse,
  type ComparableUnitClassGroup,
  type ComparableUnitSummary,
  type PerformanceBandDistributionBucket,
  type PerformanceBandInput,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { loadCohortAchievementByAssessment } from '../common/helpers/cohort-item-stats.helper';
import {
  levelCountsToBandDistribution,
  loadCohortLevelCounts,
} from '../common/helpers/cohort-level-stats.helper';
import { InjectDb, type Database } from '../database/database.types';
import { loadInstrumentBands } from '../performance-bands/lib/load-instrument-bands';
import { DashboardsService } from './dashboards.service';

type UnitAccumulator = {
  ref: ComparabilityInstrumentRef;
  instrumentName: string;
  subjectName: string | null;
  gradeName: string | null;
  assessmentIds: string[];
  lastAdministeredAt: Date | null;
};

type AchievementByAssessment = Map<string, { achievement: number | null; students: number }>;

@Injectable()
export class ComparableOverviewService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly dashboards: DashboardsService,
  ) {}

  async getComparableOverview(
    user: JwtPayload,
    query: ComparableOverviewQueryDto,
  ): Promise<ComparableOverviewResponse> {
    const scopeInfo = await this.dashboards.resolveScopeForComparableOverview(user, query);
    if (!scopeInfo) {
      return {
        scope: 'org',
        units: [],
        totals: { assessments: 0, studentsEvaluated: 0 },
        comparability: buildComparabilityMeta([]),
      };
    }

    const { orgId, isTeacherScope, classGroupIds, assessmentIds, refs } = scopeInfo;
    const emptyResponse: ComparableOverviewResponse = {
      scope: isTeacherScope ? 'teacher' : 'org',
      units: [],
      totals: { assessments: 0, studentsEvaluated: 0 },
      comparability: buildComparabilityMeta(refs, assessmentIds.length),
    };
    if (assessmentIds.length === 0) return emptyResponse;

    return withOrgContext(this.db, orgId, async (tx) => {
      const units = await this.loadUnits(tx, orgId, assessmentIds, refs);
      if (units.length === 0) return emptyResponse;

      const achievementByAssessment = await this.loadAchievementByAssessment(
        tx,
        assessmentIds,
        classGroupIds,
      );

      const summaries: ComparableUnitSummary[] = [];
      for (const unit of units) {
        summaries.push(
          await this.buildSummary(tx, orgId, unit, achievementByAssessment, classGroupIds),
        );
      }

      await this.attachBaselines(tx, orgId, summaries, classGroupIds);

      summaries.sort((a, b) => {
        const bySeverity = compareSeverity(a.severity, b.severity);
        if (bySeverity !== 0) return bySeverity;
        return this.recencyRank(b.lastAdministeredAt) - this.recencyRank(a.lastAdministeredAt);
      });

      const studentsEvaluated = summaries.reduce((acc, u) => acc + u.studentsAssessed, 0);

      return {
        scope: isTeacherScope ? 'teacher' : 'org',
        units: summaries,
        totals: { assessments: assessmentIds.length, studentsEvaluated },
        comparability: buildComparabilityMeta(refs, assessmentIds.length),
      };
    });
  }

  private recencyRank(value: Date | string | null): number {
    if (!value) return 0;
    const date = typeof value === 'string' ? new Date(value) : value;
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  private async loadUnits(
    tx: Database,
    orgId: string,
    assessmentIds: string[],
    refs: ComparabilityInstrumentRef[],
  ): Promise<UnitAccumulator[]> {
    const rows = await tx
      .select({
        assessmentId: assessments.id,
        administeredAt: assessments.administeredAt,
        instrumentId: instruments.id,
        instrumentName: instruments.name,
        subjectName: subjects.name,
        gradeName: grades.name,
      })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
      .leftJoin(grades, eq(grades.id, instruments.gradeId))
      .where(and(eq(assessments.orgId, orgId), inArray(assessments.id, assessmentIds)));

    const refById = new Map(refs.map((r) => [r.instrumentId, r]));
    const byInstrument = new Map<string, UnitAccumulator>();
    for (const row of rows) {
      const ref = refById.get(row.instrumentId);
      if (!ref) continue;
      let unit = byInstrument.get(row.instrumentId);
      if (!unit) {
        unit = {
          ref,
          instrumentName: row.instrumentName,
          subjectName: row.subjectName,
          gradeName: row.gradeName,
          assessmentIds: [],
          lastAdministeredAt: null,
        };
        byInstrument.set(row.instrumentId, unit);
      }
      unit.assessmentIds.push(row.assessmentId);
      if (
        row.administeredAt &&
        (unit.lastAdministeredAt === null || row.administeredAt > unit.lastAdministeredAt)
      ) {
        unit.lastAdministeredAt = row.administeredAt;
      }
    }
    return Array.from(byInstrument.values());
  }

  private async loadAchievementByAssessment(
    tx: Database,
    assessmentIds: string[],
    classGroupIds: string[] | null,
  ): Promise<AchievementByAssessment> {
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

  private async buildSummary(
    tx: Database,
    orgId: string,
    unit: UnitAccumulator,
    achievementByAssessment: AchievementByAssessment,
    classGroupIds: string[] | null,
  ): Promise<ComparableUnitSummary> {
    const bands = await loadInstrumentBands(tx, unit.ref.instrumentId);
    const { achievement, students } = this.foldAchievement(
      unit.assessmentIds,
      achievementByAssessment,
    );

    const bandDistribution =
      bands.length > 0
        ? await this.resolveBandDistribution(tx, unit.assessmentIds, classGroupIds, bands)
        : null;
    const lowestBandShare = this.lowestBandShare(bandDistribution);

    const byClassGroup = await this.loadByClassGroup(tx, orgId, unit.assessmentIds, classGroupIds);

    return {
      key: unit.ref.instrumentId,
      instrumentId: unit.ref.instrumentId,
      instrumentName: unit.instrumentName,
      instrumentType: unit.ref.type,
      subjectId: unit.ref.subjectId,
      subjectName: unit.subjectName,
      gradeId: unit.ref.gradeId,
      gradeName: unit.gradeName,
      applicationPeriod: unit.ref.applicationPeriod,
      year: unit.ref.year,
      assessmentIds: unit.assessmentIds,
      lastAdministeredAt: unit.lastAdministeredAt,
      studentsAssessed: students,
      averageAchievement: achievement,
      bands: bands.length > 0 ? bands.map(toBandView) : null,
      bandDistribution,
      levelDistribution: null,
      lowestBandShare,
      byClassGroup,
      baseline: null,
      severity: severityFromLowestBandShare(lowestBandShare),
    };
  }

  private foldAchievement(
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
   *  1. `assessment_level_stats` — el read-model de cohorte, que es lo único que hay
   *     cuando la evaluación vino de un informe oficial agregado.
   *  2. `assessment_results.performance_band_id` — la banda ya escrita por alumno.
   *  3. El `percentage` de cada alumno clasificado con las bandas DEL INSTRUMENTO.
   *
   * El tercero es el que cubre el caso normal de una evaluación calculada desde
   * respuestas, donde nadie escribió la banda pero el corte del instrumento existe. Sin
   * él la severidad quedaba en null para casi todas las unidades, y el orden por
   * severidad —que es lo que ordena el panorama— se degradaba a orden por fecha.
   */
  private async resolveBandDistribution(
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

  private lowestBandShare(
    distribution: { order: number; percentage: number }[] | null,
  ): number | null {
    if (!distribution || distribution.length === 0) return null;
    const lowest = distribution.reduce((min, b) => (b.order < min.order ? b : min));
    return lowest.percentage;
  }

  private async loadByClassGroup(
    tx: Database,
    orgId: string,
    assessmentIds: string[],
    classGroupIds: string[] | null,
  ): Promise<ComparableUnitClassGroup[]> {
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
        avgPct: sql<string | null>`avg(${assessmentResults.percentage}::numeric)`,
        students: sql<number>`count(distinct ${assessmentResults.studentId})::int`,
      })
      .from(assessmentResults)
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .innerJoin(studentEnrollments, eq(studentEnrollments.studentId, assessmentResults.studentId))
      .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
      .leftJoin(grades, eq(grades.id, classGroups.gradeId))
      .where(and(...conditions))
      .groupBy(classGroups.id, classGroups.name, grades.name);

    return rows
      .map((row) => ({
        classGroupId: row.classGroupId,
        classGroupName: row.classGroupName,
        gradeName: row.gradeName,
        studentsAssessed: Number(row.students ?? 0),
        averageAchievement: row.avgPct == null ? null : Number(row.avgPct),
        lowestBandShare: null,
      }))
      .sort((a, b) => (a.averageAchievement ?? 101) - (b.averageAchievement ?? 101));
  }

  private async attachBaselines(
    tx: Database,
    orgId: string,
    summaries: ComparableUnitSummary[],
    classGroupIds: string[] | null,
  ): Promise<void> {
    const candidates = await this.loadBaselineCandidates(tx, orgId, summaries);
    if (candidates.size === 0) return;

    for (const unit of summaries) {
      const ref = this.refOf(unit);
      const previousYear = candidates.get(
        `${buildInstrumentFamilyKey(ref)}::${(ref.year ?? 0) - 1}`,
      );
      const previousPeriodKey = previousApplicationPeriod(ref.applicationPeriod);
      const previousPeriod = previousPeriodKey
        ? candidates.get(`${buildPeriodSeriesKey(ref)}::${previousPeriodKey}`)
        : undefined;

      const chosen = previousPeriod ?? previousYear;
      if (!chosen || chosen.instrumentId === unit.instrumentId) continue;

      const achievement = await this.baselineAchievement(tx, chosen.assessmentIds, classGroupIds);
      const baseline: BaselineRef = {
        kind: previousPeriod ? 'previous_period' : 'previous_year',
        label: chosen.label,
        instrumentId: chosen.instrumentId,
        assessmentIds: chosen.assessmentIds,
        achievement,
        deltaPp: deltaInPoints(unit.averageAchievement, achievement),
      };
      unit.baseline = baseline;
    }
  }

  private refOf(unit: ComparableUnitSummary): ComparabilityInstrumentRef {
    return {
      instrumentId: unit.instrumentId,
      type: unit.instrumentType,
      subjectId: unit.subjectId,
      gradeId: unit.gradeId,
      applicationPeriod: unit.applicationPeriod,
      year: unit.year,
    };
  }

  private async loadBaselineCandidates(
    tx: Database,
    orgId: string,
    summaries: ComparableUnitSummary[],
  ): Promise<Map<string, { instrumentId: string; label: string; assessmentIds: string[] }>> {
    const types = Array.from(new Set(summaries.map((u) => u.instrumentType)));
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

    const byKey = new Map<
      string,
      { instrumentId: string; label: string; assessmentIds: string[] }
    >();
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

  private async baselineAchievement(
    tx: Database,
    assessmentIds: string[],
    classGroupIds: string[] | null,
  ): Promise<number | null> {
    const byAssessment = await this.loadAchievementByAssessment(tx, assessmentIds, classGroupIds);
    return this.foldAchievement(assessmentIds, byAssessment).achievement;
  }
}

function toBandView(band: PerformanceBandInput) {
  return { key: band.key, label: band.label, order: band.order, color: band.color ?? null };
}
