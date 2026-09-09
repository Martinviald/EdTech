import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { assessments, grades, instruments, subjects, withOrgContext } from '@soe/db';
import {
  buildComparabilityMeta,
  compareSeverity,
  deltaInPoints,
  deriveGenerationalHighlights,
  severityFromLowestBandShare,
  MAX_DASHBOARD_ALERTS,
  type BaselineRef,
  type ComparabilityInstrumentRef,
  type ComparableAlertsResponse,
  type ComparableOverviewQueryDto,
  type ComparableOverviewResponse,
  type ComparableUnitSummary,
  type PerformanceBandInput,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { CohortLevelCount } from '../common/helpers/cohort-level-stats.helper';
import { InjectDb, type Database } from '../database/database.types';
import { loadBandsForInstruments } from '../performance-bands/lib/load-instrument-bands';
import { ComparableAlertsService } from './comparable-alerts.service';
import {
  ComparableUnitAssembler,
  type AchievementByAssessment,
  type BandClassificationRow,
  type BaselineCandidate,
  type ClassGroupBreakdownData,
} from './comparable/comparable-unit.assembler';
import { DashboardsService } from './dashboards.service';

type ScopeData = {
  achievementByAssessment: AchievementByAssessment;
  bandsByInstrument: Map<string, PerformanceBandInput[]>;
  levelCountsByAssessment: Map<string, CohortLevelCount[]>;
  classGroupBreakdownByInstrument: Map<string, ClassGroupBreakdownData>;
  classificationRowsByAssessment: Map<string, BandClassificationRow[]>;
};

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
        alertsTotal: 0,
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
      alertsTotal: 0,
      units: [],
      generational: [],
      totals: { assessments: 0, studentsEvaluated: 0 },
      comparability: buildComparabilityMeta(refs, assessmentIds.length),
    };
    if (assessmentIds.length === 0) return emptyResponse;

    return withOrgContext(this.db, orgId, async (tx) => {
      const units = await this.loadUnits(tx, orgId, assessmentIds, refs);
      if (units.length === 0) return emptyResponse;

      const scopeData = await this.loadScopeData(tx, orgId, units, assessmentIds, classGroupIds);
      const summaries = units.map((unit) => this.buildSummary(unit, scopeData));

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
        alerts: alerts.slice(0, MAX_DASHBOARD_ALERTS),
        alertsTotal: alerts.length,
        units: summaries,
        generational: deriveGenerationalHighlights(summaries),
        totals: { assessments: assessmentIds.length, studentsEvaluated },
        comparability: buildComparabilityMeta(refs, assessmentIds.length),
      };
    });
  }

  /**
   * Las alertas solas, para el refresco en segundo plano de la banda.
   *
   * Reusa el armado completo en vez de derivarlas por su cuenta: toda alerta se
   * calcula SOBRE las unidades ya resueltas (su banda, su baseline, su desglose por
   * curso), así que un atajo que se saltara ese armado devolvería otras alertas. Lo
   * que se ahorra acá es red, que es lo que sufre una conexión de colegio; el costo
   * de cómputo lo bajan las fases siguientes, y las baja para los dos endpoints.
   */
  async getComparableAlerts(
    user: JwtPayload,
    query: ComparableOverviewQueryDto,
  ): Promise<ComparableAlertsResponse> {
    const { alerts, alertsTotal } = await this.getComparableOverview(user, query);
    return { alerts, alertsTotal };
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

  /**
   * Todo lo que las unidades necesitan, en una query por tipo de dato en vez de una
   * por unidad.
   *
   * Antes cada unidad disparaba sus bandas, sus conteos de cohorte (una query POR
   * evaluación), su distribución y su desglose por curso, encadenadas con `await`
   * dentro de un `for`: 593 idas y vueltas para el alcance completo de un colegio,
   * todas dentro de la misma transacción. Los datos son los mismos; lo que cambia es
   * que se piden juntos.
   */
  private async loadScopeData(
    tx: Database,
    orgId: string,
    units: UnitAccumulator[],
    assessmentIds: string[],
    classGroupIds: string[] | null,
  ): Promise<ScopeData> {
    const [
      achievementByAssessment,
      bandsByInstrument,
      levelCountsByAssessment,
      classGroupBreakdown,
    ] = await Promise.all([
      this.assembler.loadAchievementByAssessment(tx, assessmentIds, classGroupIds),
      loadBandsForInstruments(
        tx,
        units.map((unit) => unit.ref.instrumentId),
      ),
      this.assembler.loadLevelCountsByAssessment(tx, assessmentIds, classGroupIds),
      this.assembler.loadClassGroupBreakdown(tx, orgId, assessmentIds, classGroupIds),
    ]);

    const classGroupBreakdownByInstrument = new Map<string, ClassGroupBreakdownData>();
    const breakdownFor = (instrumentId: string): ClassGroupBreakdownData => {
      const existing = classGroupBreakdownByInstrument.get(instrumentId);
      if (existing) return existing;
      const created: ClassGroupBreakdownData = { totals: [], classification: [] };
      classGroupBreakdownByInstrument.set(instrumentId, created);
      return created;
    };
    for (const row of classGroupBreakdown.totals) breakdownFor(row.instrumentId).totals.push(row);
    for (const row of classGroupBreakdown.classification) {
      breakdownFor(row.instrumentId).classification.push(row);
    }

    const needsClassificationRows = units.some((unit) => {
      const bands = bandsByInstrument.get(unit.ref.instrumentId) ?? [];
      if (bands.length === 0) return false;
      return (
        this.assembler.foldLevelCounts(unit.assessmentIds, levelCountsByAssessment).length === 0
      );
    });
    const classificationRowsByAssessment = needsClassificationRows
      ? await this.assembler.loadBandClassificationRows(tx, assessmentIds)
      : new Map<string, BandClassificationRow[]>();

    return {
      achievementByAssessment,
      bandsByInstrument,
      levelCountsByAssessment,
      classGroupBreakdownByInstrument,
      classificationRowsByAssessment,
    };
  }

  private buildSummary(unit: UnitAccumulator, scope: ScopeData): ComparableUnitSummary {
    const bands = scope.bandsByInstrument.get(unit.ref.instrumentId) ?? [];
    const { achievement, students } = this.assembler.foldAchievement(
      unit.assessmentIds,
      scope.achievementByAssessment,
    );

    const bandDistribution =
      bands.length > 0
        ? this.assembler.foldBandDistribution(
            this.assembler.foldLevelCounts(unit.assessmentIds, scope.levelCountsByAssessment),
            unit.assessmentIds.flatMap(
              (assessmentId) => scope.classificationRowsByAssessment.get(assessmentId) ?? [],
            ),
            bands,
          )
        : null;
    const lowestBandShare = this.assembler.lowestBandShare(bandDistribution);

    const byClassGroup = this.assembler.foldByClassGroup(
      scope.classGroupBreakdownByInstrument.get(unit.ref.instrumentId) ?? {
        totals: [],
        classification: [],
      },
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

    const chosenByUnit = new Map<
      ComparableUnitSummary,
      { candidate: BaselineCandidate; kind: BaselineRef['kind'] }
    >();
    for (const unit of summaries) {
      const { previousPeriod, previousYear } = this.assembler.resolveBaselineChoices(
        this.refOf(unit),
        candidates,
      );
      const candidate = previousPeriod ?? previousYear;
      if (!candidate || candidate.instrumentId === unit.instrumentId) continue;
      chosenByUnit.set(unit, {
        candidate,
        kind: previousPeriod ? 'previous_period' : 'previous_year',
      });
    }
    if (chosenByUnit.size === 0) return;

    const baselineAssessmentIds = Array.from(
      new Set(
        Array.from(chosenByUnit.values()).flatMap(({ candidate }) => candidate.assessmentIds),
      ),
    );
    const achievementByAssessment = await this.assembler.loadAchievementByAssessment(
      tx,
      baselineAssessmentIds,
      classGroupIds,
    );

    for (const [unit, { candidate, kind }] of chosenByUnit) {
      const { achievement } = this.assembler.foldAchievement(
        candidate.assessmentIds,
        achievementByAssessment,
      );
      unit.baseline = {
        kind,
        label: candidate.label,
        instrumentId: candidate.instrumentId,
        assessmentIds: candidate.assessmentIds,
        achievement,
        deltaPp: deltaInPoints(unit.averageAchievement, achievement),
      };
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
