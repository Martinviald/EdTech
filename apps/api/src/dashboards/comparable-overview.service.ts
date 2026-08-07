import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { assessments, grades, instruments, subjects, withOrgContext } from '@soe/db';
import {
  buildComparabilityMeta,
  compareSeverity,
  deltaInPoints,
  deriveGenerationalHighlights,
  severityFromLowestBandShare,
  type BaselineRef,
  type ComparabilityInstrumentRef,
  type ComparableOverviewQueryDto,
  type ComparableOverviewResponse,
  type ComparableUnitSummary,
  type PerformanceBandInput,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { loadInstrumentBands } from '../performance-bands/lib/load-instrument-bands';
import { ComparableAlertsService } from './comparable-alerts.service';
import {
  ComparableUnitAssembler,
  type AchievementByAssessment,
} from './comparable/comparable-unit.assembler';
import { DashboardsService } from './dashboards.service';

type UnitAccumulator = {
  ref: ComparabilityInstrumentRef;
  instrumentName: string;
  subjectName: string | null;
  gradeName: string | null;
  assessmentIds: string[];
  lastAdministeredAt: Date | null;
};

@Injectable()
export class ComparableOverviewService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly dashboards: DashboardsService,
    private readonly alerts: ComparableAlertsService,
    private readonly assembler: ComparableUnitAssembler,
  ) {}

  async getComparableOverview(
    user: JwtPayload,
    query: ComparableOverviewQueryDto,
  ): Promise<ComparableOverviewResponse> {
    const scopeInfo = await this.dashboards.resolveScopeForComparableOverview(user, query);
    if (!scopeInfo) {
      return {
        scope: 'org',
        alerts: [],
        units: [],
        generational: [],
        totals: { assessments: 0, studentsEvaluated: 0 },
        comparability: buildComparabilityMeta([]),
      };
    }

    const { orgId, isTeacherScope, classGroupIds, assessmentIds, refs } = scopeInfo;
    const emptyResponse: ComparableOverviewResponse = {
      scope: isTeacherScope ? 'teacher' : 'org',
      alerts: [],
      units: [],
      generational: [],
      totals: { assessments: 0, studentsEvaluated: 0 },
      comparability: buildComparabilityMeta(refs, assessmentIds.length),
    };
    if (assessmentIds.length === 0) return emptyResponse;

    return withOrgContext(this.db, orgId, async (tx) => {
      const units = await this.loadUnits(tx, orgId, assessmentIds, refs);
      if (units.length === 0) return emptyResponse;

      const achievementByAssessment = await this.assembler.loadAchievementByAssessment(
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
      const alerts = await this.alerts.deriveAlerts(tx, orgId, summaries, classGroupIds);

      return {
        scope: isTeacherScope ? 'teacher' : 'org',
        alerts,
        units: summaries,
        generational: deriveGenerationalHighlights(summaries),
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

  private async buildSummary(
    tx: Database,
    orgId: string,
    unit: UnitAccumulator,
    achievementByAssessment: AchievementByAssessment,
    classGroupIds: string[] | null,
  ): Promise<ComparableUnitSummary> {
    const bands = await loadInstrumentBands(tx, unit.ref.instrumentId);
    const { achievement, students } = this.assembler.foldAchievement(
      unit.assessmentIds,
      achievementByAssessment,
    );

    const bandDistribution =
      bands.length > 0
        ? await this.assembler.resolveBandDistribution(tx, unit.assessmentIds, classGroupIds, bands)
        : null;
    const lowestBandShare = this.assembler.lowestBandShare(bandDistribution);

    const byClassGroup = await this.assembler.loadByClassGroup(
      tx,
      orgId,
      unit.assessmentIds,
      classGroupIds,
      bands,
    );

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

  private async attachBaselines(
    tx: Database,
    orgId: string,
    summaries: ComparableUnitSummary[],
    classGroupIds: string[] | null,
  ): Promise<void> {
    const candidates = await this.assembler.loadBaselineCandidates(
      tx,
      orgId,
      summaries.map((u) => this.refOf(u)),
    );
    if (candidates.size === 0) return;

    for (const unit of summaries) {
      const ref = this.refOf(unit);
      const { previousPeriod, previousYear } = this.assembler.resolveBaselineChoices(
        ref,
        candidates,
      );

      const chosen = previousPeriod ?? previousYear;
      if (!chosen || chosen.instrumentId === unit.instrumentId) continue;

      const achievement = await this.assembler.baselineAchievement(
        tx,
        chosen.assessmentIds,
        classGroupIds,
      );
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
}

function toBandView(band: PerformanceBandInput) {
  return { key: band.key, label: band.label, order: band.order, color: band.color ?? null };
}
