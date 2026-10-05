import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  assessmentCourseAssignments,
  assessmentItemStats,
  assessmentSkillStats,
  assessments,
  classGroups,
  items,
  performanceBands,
  studentEnrollments,
  taxonomyNodes,
} from '@soe/db';
import {
  ALERT_BASIS_BY_TYPE,
  ALERT_THRESHOLDS,
  AUTO_SCORABLE_ITEM_TYPES,
  ALERT_HIDDEN_NODE_TYPES,
  sampleDeltaPp,
  type AlertSeverity,
  type ComparableUnitSummary,
  type DashboardAlert,
  type DashboardAlertCohort,
  type DashboardAlertType,
  type InstrumentSample,
  type InstrumentSampleEntry,
  type SampleSkillStat,
} from '@soe/types';
import {
  assessmentAcademicYears,
  scopedAssessmentResults,
} from '../common/helpers/assessment-academic-year.helper';
import type { Database } from '../database/database.types';

type AlertDraft = Omit<DashboardAlert, 'dedupKey' | 'basis' | 'cohort'> & {
  dedupKey?: string;
  cohort?: DashboardAlertCohort | null;
  fusionReason?: string;
};

type NodeAchievement = {
  unit: ComparableUnitSummary;
  nodeId: string;
  nodeName: string;
  achievement: number;
};

const FUSES_INTO: Partial<Record<DashboardAlertType, DashboardAlertType>> = {
  band_concentration_above_sample: 'band_concentration',
  skill_below_sample: 'skill_gap',
  class_below_sample: 'class_below_org',
};

export type InstrumentSampleLookup = ReadonlyMap<string, InstrumentSampleEntry>;

@Injectable()
export class ComparableAlertsService {
  async deriveAlerts(
    tx: Database,
    orgId: string,
    units: ComparableUnitSummary[],
    classGroupIds: string[] | null,
    samples: InstrumentSampleLookup | null = null,
  ): Promise<DashboardAlert[]> {
    if (units.length === 0) return [];

    const nodeAchievements = await this.loadNodeAchievements(tx, units);
    const drafts: AlertDraft[] = [
      ...this.bandConcentrationAlerts(units, samples),
      ...this.bandConcentrationAboveSampleAlerts(units, samples),
      ...this.movementAlerts(units),
      ...this.classBelowUnitAlerts(units),
      ...this.sampleAlerts(units, samples),
      ...this.skillGapAlerts(nodeAchievements),
      ...this.skillBelowSampleAlerts(nodeAchievements, samples),
      ...(await this.itemGapAlerts(tx, units)),
      ...(await this.bandRegressionAlerts(tx, units)),
      ...(await this.coverageAlerts(tx, orgId, units, classGroupIds)),
    ];

    return this.dedupeAndRank(drafts);
  }

  private dedupeAndRank(drafts: AlertDraft[]): DashboardAlert[] {
    const byKey = new Map<string, AlertDraft & { dedupKey: string }>();
    for (const draft of drafts) {
      const dedupKey = draft.dedupKey ?? this.defaultDedupKey(draft.type, draft);
      if (byKey.has(dedupKey)) continue;
      byKey.set(dedupKey, { ...draft, dedupKey });
    }
    this.fuseWithSample(byKey);

    const alerts = Array.from(byKey.values(), (draft) => this.toAlert(draft));
    return alerts.sort((a, b) => {
      const bySeverity = severityRank(a.severity) - severityRank(b.severity);
      if (bySeverity !== 0) return bySeverity;
      return (b.studentsAffected ?? 0) - (a.studentsAffected ?? 0);
    });
  }

  private toAlert(draft: AlertDraft & { dedupKey: string }): DashboardAlert {
    return {
      type: draft.type,
      severity: draft.severity,
      message: draft.message,
      contextKind: draft.contextKind,
      contextId: draft.contextId,
      contextLabel: draft.contextLabel,
      value: draft.value,
      unitKey: draft.unitKey,
      unitLabel: draft.unitLabel,
      studentsAffected: draft.studentsAffected,
      dedupKey: draft.dedupKey,
      basis: ALERT_BASIS_BY_TYPE[draft.type],
      cohort: draft.cohort ?? null,
    };
  }

  private defaultDedupKey(
    type: DashboardAlertType,
    draft: Pick<AlertDraft, 'unitKey' | 'contextId'>,
  ): string {
    return `${type}:${draft.unitKey ?? '-'}:${draft.contextId ?? '-'}`;
  }

  private fuseWithSample(byKey: Map<string, AlertDraft & { dedupKey: string }>): void {
    for (const [key, relative] of [...byKey]) {
      const target = FUSES_INTO[relative.type];
      if (!target) continue;
      const base = byKey.get(this.defaultDedupKey(target, relative));
      if (!base) continue;
      byKey.set(base.dedupKey, {
        ...base,
        severity:
          severityRank(relative.severity) < severityRank(base.severity)
            ? relative.severity
            : base.severity,
        message: relative.fusionReason
          ? `${base.message}, y ${relative.fusionReason}`
          : base.message,
        cohort: relative.cohort ?? base.cohort ?? null,
      });
      byKey.delete(key);
    }
  }

  private sampleAlerts(
    units: ComparableUnitSummary[],
    samples: InstrumentSampleLookup | null,
  ): AlertDraft[] {
    if (!samples) return [];
    const drafts: AlertDraft[] = [];
    for (const unit of units) {
      const entry = samples.get(unit.instrumentId);
      const sample = entry?.global;
      if (!entry || !sample) continue;

      const unitSeverity = this.belowSampleSeverity(unit.averageAchievement, sample);
      if (unitSeverity && unit.averageAchievement !== null) {
        drafts.push({
          type: 'below_sample',
          severity: unitSeverity,
          message: `${unit.instrumentName}: ${unit.averageAchievement.toFixed(1)}% de logro, bajo la zona típica de la muestra (${this.formatZone(sample)})`,
          contextKind: 'assessment',
          contextId: unit.assessmentIds[0] ?? null,
          contextLabel: unit.instrumentName,
          value: unit.averageAchievement,
          unitKey: unit.key,
          unitLabel: unit.instrumentName,
          studentsAffected: unit.studentsAssessed,
          cohort: this.cohortOf(unit.averageAchievement, sample, entry.you?.percentile ?? null),
        });
      }

      if (unit.byClassGroup.length < 2) continue;
      for (const course of unit.byClassGroup) {
        const severity = this.belowSampleSeverity(course.averageAchievement, sample);
        if (!severity || course.averageAchievement === null) continue;
        drafts.push({
          type: 'class_below_sample',
          severity,
          message: `${course.classGroupName}: ${course.averageAchievement.toFixed(1)}% en ${unit.instrumentName}, bajo la zona típica de la muestra (${this.formatZone(sample)})`,
          contextKind: 'class_group',
          contextId: course.classGroupId,
          contextLabel: course.classGroupName,
          value: course.averageAchievement,
          unitKey: unit.key,
          unitLabel: unit.instrumentName,
          studentsAffected: course.studentsAssessed,
          cohort: this.cohortOf(course.averageAchievement, sample, null),
          fusionReason: `bajo la zona típica de la muestra (${this.formatZone(sample)})`,
        });
      }
    }
    return drafts;
  }

  private belowSampleSeverity(
    value: number | null,
    sample: InstrumentSample,
  ): AlertSeverity | null {
    const delta = sampleDeltaPp(value, sample.avgAchievement);
    if (value === null || delta === null) return null;
    const { belowSamplePp } = ALERT_THRESHOLDS.cohort;
    if (sample.p10 !== null && value < sample.p10 && delta <= -belowSamplePp.high) return 'high';
    if (sample.p25 !== null && value < sample.p25 && delta <= -belowSamplePp.medium)
      return 'medium';
    return null;
  }

  private cohortOf(
    value: number | null,
    sample: InstrumentSample,
    percentile: number | null,
  ): DashboardAlertCohort {
    const delta = sampleDeltaPp(value, sample.avgAchievement);
    return {
      sampleValue: sample.avgAchievement,
      schoolCount: sample.schoolCount,
      studentCount: sample.studentCount,
      percentile,
      similarToSample: delta !== null && Math.abs(delta) < ALERT_THRESHOLDS.cohort.similarPp,
    };
  }

  private formatZone(sample: InstrumentSample): string {
    const low = sample.p25 === null ? '—' : sample.p25.toFixed(1);
    const high = sample.p75 === null ? '—' : sample.p75.toFixed(1);
    return `${low}–${high}%`;
  }

  private skillBelowSampleAlerts(
    nodes: NodeAchievement[],
    samples: InstrumentSampleLookup | null,
  ): AlertDraft[] {
    if (!samples) return [];
    const drafts: AlertDraft[] = [];
    const skillsByInstrument = new Map<string, Map<string, SampleSkillStat>>();
    for (const entry of nodes) {
      const sample = samples.get(entry.unit.instrumentId)?.global;
      if (!sample) continue;
      let skills = skillsByInstrument.get(sample.instrumentId);
      if (!skills) {
        skills = new Map(sample.perSkill.map((skill) => [skill.nodeId, skill]));
        skillsByInstrument.set(sample.instrumentId, skills);
      }
      const skill = skills.get(entry.nodeId);
      const sampleAchievement = skill?.achievement ?? null;
      const delta = sampleDeltaPp(entry.achievement, sampleAchievement);
      if (!skill || delta === null || sampleAchievement === null) continue;
      const severity = this.skillBelowSampleSeverity(entry.achievement, delta, skill);
      if (!severity) continue;
      drafts.push({
        type: 'skill_below_sample',
        severity,
        message: `En ${entry.unit.instrumentName}, ${shorten(entry.nodeName)} está ${Math.abs(delta).toFixed(1)} pp bajo la muestra (${entry.achievement.toFixed(0)}% vs ${sampleAchievement.toFixed(0)}%)`,
        contextKind: 'taxonomy_node',
        contextId: entry.nodeId,
        contextLabel: entry.nodeName,
        value: Number(entry.achievement.toFixed(1)),
        unitKey: entry.unit.key,
        unitLabel: entry.unit.instrumentName,
        studentsAffected: entry.unit.studentsAssessed,
        cohort: {
          sampleValue: skill.achievement,
          schoolCount: skill.schoolCount,
          studentCount: skill.studentCount,
          percentile: null,
          similarToSample: false,
        },
        fusionReason: `${Math.abs(delta).toFixed(1)} pp bajo la muestra`,
      });
    }
    return drafts;
  }

  private skillBelowSampleSeverity(
    achievement: number,
    delta: number,
    skill: SampleSkillStat,
  ): AlertSeverity | null {
    const { skillBelowSamplePp } = ALERT_THRESHOLDS.cohort;
    if (skill.p10 !== null && achievement < skill.p10 && delta <= -skillBelowSamplePp.high) {
      return 'high';
    }
    if (skill.p25 !== null && achievement < skill.p25 && delta <= -skillBelowSamplePp.medium) {
      return 'medium';
    }
    return null;
  }

  private bandConcentrationAboveSampleAlerts(
    units: ComparableUnitSummary[],
    samples: InstrumentSampleLookup | null,
  ): AlertDraft[] {
    if (!samples) return [];
    const drafts: AlertDraft[] = [];
    for (const unit of units) {
      const sample = samples.get(unit.instrumentId)?.global;
      const sampleShare = sample ? this.sampleLowestBandShare(unit, sample) : null;
      if (!sample || sampleShare === null) continue;
      const bandLabel = this.lowestBand(unit)?.label ?? 'el nivel más bajo';
      for (const course of unit.byClassGroup) {
        const share = course.lowestBandShare;
        const excess = share === null ? null : share - sampleShare;
        const severity = thresholdSeverity(
          excess,
          ALERT_THRESHOLDS.cohort.bandConcentrationAbovePp,
        );
        if (!severity || share === null || excess === null) continue;
        drafts.push({
          type: 'band_concentration_above_sample',
          severity,
          message: `${course.classGroupName}: ${share.toFixed(0)}% en ${bandLabel} de ${unit.instrumentName}, ${excess.toFixed(0)} pp más que la muestra (${sampleShare.toFixed(0)}%)`,
          contextKind: 'class_group',
          contextId: course.classGroupId,
          contextLabel: course.classGroupName,
          value: Number(share.toFixed(1)),
          unitKey: unit.key,
          unitLabel: unit.instrumentName,
          studentsAffected: Math.round((share / 100) * course.studentsAssessed),
          cohort: this.bandCohortOf(share, sampleShare, sample),
          fusionReason: `${excess.toFixed(0)} pp más que la muestra (${sampleShare.toFixed(0)}%)`,
        });
      }
    }
    return drafts;
  }

  private lowestBand(unit: ComparableUnitSummary): { key: string; label: string } | null {
    let lowest: { key: string; label: string; order: number } | null = null;
    for (const band of unit.bands ?? []) {
      if (!lowest || band.order < lowest.order) lowest = band;
    }
    return lowest;
  }

  private sampleLowestBandShare(
    unit: ComparableUnitSummary,
    sample: InstrumentSample,
  ): number | null {
    const lowestKey = this.lowestBand(unit)?.key;
    if (!lowestKey || sample.bandCounts.length === 0) return null;
    let total = 0;
    let lowestCount: number | null = null;
    let lowestOrder = Infinity;
    let lowestSampleKey: string | null = null;
    for (const band of sample.bandCounts) {
      total += band.count;
      if (band.order < lowestOrder) {
        lowestOrder = band.order;
        lowestSampleKey = band.bandKey;
        lowestCount = band.count;
      }
    }
    if (total === 0 || lowestSampleKey !== lowestKey || lowestCount === null) return null;
    return (lowestCount / total) * 100;
  }

  private bandCohortOf(
    share: number,
    sampleShare: number,
    sample: InstrumentSample,
  ): DashboardAlertCohort {
    return {
      sampleValue: Number(sampleShare.toFixed(1)),
      schoolCount: sample.schoolCount,
      studentCount: sample.studentCount,
      percentile: null,
      similarToSample: Math.abs(share - sampleShare) < ALERT_THRESHOLDS.cohort.similarPp,
    };
  }

  private bandConcentrationAlerts(
    units: ComparableUnitSummary[],
    samples: InstrumentSampleLookup | null,
  ): AlertDraft[] {
    const drafts: AlertDraft[] = [];
    for (const unit of units) {
      const sample = samples?.get(unit.instrumentId)?.global ?? null;
      const sampleShare = sample ? this.sampleLowestBandShare(unit, sample) : null;
      for (const course of unit.byClassGroup) {
        const share = course.lowestBandShare;
        const severity = thresholdSeverity(share, ALERT_THRESHOLDS.bandConcentration);
        if (!severity || share == null) continue;
        const bandLabel = unit.bands?.[0]?.label ?? 'el nivel más bajo';
        drafts.push({
          type: 'band_concentration',
          severity,
          message: `${course.classGroupName}: ${share.toFixed(0)}% de los alumnos en ${bandLabel} de ${unit.instrumentName}`,
          contextKind: 'class_group',
          contextId: course.classGroupId,
          contextLabel: course.classGroupName,
          value: Number(share.toFixed(1)),
          unitKey: unit.key,
          unitLabel: unit.instrumentName,
          studentsAffected: Math.round((share / 100) * course.studentsAssessed),
          cohort:
            sample && sampleShare !== null ? this.bandCohortOf(share, sampleShare, sample) : null,
        });
      }
    }
    return drafts;
  }

  private movementAlerts(units: ComparableUnitSummary[]): AlertDraft[] {
    const drafts: AlertDraft[] = [];
    for (const unit of units) {
      const delta = unit.baseline?.deltaPp;
      if (delta == null || delta >= 0) continue;
      const severity = thresholdSeverity(Math.abs(delta), ALERT_THRESHOLDS.dropPp);
      if (!severity) continue;

      const isPeriod = unit.baseline?.kind === 'previous_period';
      drafts.push({
        type: isPeriod ? 'drop_vs_previous_period' : 'drop_vs_previous_year',
        severity,
        message: `${unit.instrumentName}: ${Math.abs(delta).toFixed(1)} pp por debajo de ${unit.baseline?.label ?? 'su comparable anterior'}`,
        contextKind: 'assessment',
        contextId: unit.assessmentIds[0] ?? null,
        contextLabel: unit.instrumentName,
        value: delta,
        unitKey: unit.key,
        unitLabel: unit.instrumentName,
        studentsAffected: unit.studentsAssessed,
      });
    }
    return drafts;
  }

  private classBelowUnitAlerts(units: ComparableUnitSummary[]): AlertDraft[] {
    const drafts: AlertDraft[] = [];
    for (const unit of units) {
      if (unit.averageAchievement == null || unit.byClassGroup.length < 2) continue;
      for (const course of unit.byClassGroup) {
        if (course.averageAchievement == null) continue;
        const gap = unit.averageAchievement - course.averageAchievement;
        const severity = thresholdSeverity(gap, ALERT_THRESHOLDS.classBelowOrgPp);
        if (!severity) continue;
        drafts.push({
          type: 'class_below_org',
          severity,
          message: `${course.classGroupName} está ${gap.toFixed(1)} pp bajo el resto del colegio en ${unit.instrumentName}`,
          contextKind: 'class_group',
          contextId: course.classGroupId,
          contextLabel: course.classGroupName,
          value: Number(gap.toFixed(1)),
          unitKey: unit.key,
          unitLabel: unit.instrumentName,
          studentsAffected: course.studentsAssessed,
        });
      }
    }
    return drafts;
  }

  private async loadNodeAchievements(
    tx: Database,
    units: ComparableUnitSummary[],
  ): Promise<NodeAchievement[]> {
    const assessmentIds = units.flatMap((u) => u.assessmentIds);
    if (assessmentIds.length === 0) return [];

    const rows = await tx
      .select({
        assessmentId: assessmentSkillStats.assessmentId,
        nodeId: assessmentSkillStats.nodeId,
        nodeName: taxonomyNodes.name,
        scoreSum: sql<string | null>`sum(${assessmentSkillStats.correctCount}::numeric)`,
        totalSum: sql<string | null>`sum(${assessmentSkillStats.totalCount}::numeric)`,
        students: sql<number>`sum(${assessmentSkillStats.studentCount})::int`,
      })
      .from(assessmentSkillStats)
      .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, assessmentSkillStats.nodeId))
      .where(
        and(
          inArray(assessmentSkillStats.assessmentId, assessmentIds),
          sql`${taxonomyNodes.type}::text <> all(${sql.raw(`array[${ALERT_HIDDEN_NODE_TYPES.map((t) => `'${t}'`).join(',')}]`)})`,
        ),
      )
      .groupBy(assessmentSkillStats.assessmentId, assessmentSkillStats.nodeId, taxonomyNodes.name);

    const unitByAssessment = new Map<string, ComparableUnitSummary>();
    for (const unit of units) {
      for (const id of unit.assessmentIds) unitByAssessment.set(id, unit);
    }

    const byUnitNode = new Map<
      string,
      {
        unit: ComparableUnitSummary;
        nodeId: string;
        nodeName: string;
        correct: number;
        total: number;
        students: number;
      }
    >();
    for (const row of rows) {
      const unit = unitByAssessment.get(row.assessmentId);
      if (!unit) continue;
      const key = `${unit.key}:${row.nodeId}`;
      const entry = byUnitNode.get(key) ?? {
        unit,
        nodeId: row.nodeId,
        nodeName: row.nodeName,
        correct: 0,
        total: 0,
        students: 0,
      };
      entry.correct += Number(row.scoreSum ?? 0);
      entry.total += Number(row.totalSum ?? 0);
      entry.students += Number(row.students ?? 0);
      byUnitNode.set(key, entry);
    }

    const achievements: NodeAchievement[] = [];
    for (const entry of byUnitNode.values()) {
      if (entry.total === 0) continue;
      achievements.push({
        unit: entry.unit,
        nodeId: entry.nodeId,
        nodeName: entry.nodeName,
        achievement: (entry.correct / entry.total) * 100,
      });
    }
    return achievements;
  }

  private skillGapAlerts(nodes: NodeAchievement[]): AlertDraft[] {
    const drafts: AlertDraft[] = [];
    for (const entry of nodes) {
      if (entry.unit.averageAchievement == null) continue;
      const achievement = entry.achievement;
      const gap = entry.unit.averageAchievement - achievement;
      const severity = thresholdSeverity(gap, ALERT_THRESHOLDS.skillGapPp);
      if (!severity) continue;
      drafts.push({
        type: 'skill_gap',
        severity,
        message: `En ${entry.unit.instrumentName}, ${shorten(entry.nodeName)} está ${gap.toFixed(1)} pp bajo el resto de la evaluación (${achievement.toFixed(0)}%)`,
        contextKind: 'taxonomy_node',
        contextId: entry.nodeId,
        contextLabel: entry.nodeName,
        value: Number(achievement.toFixed(1)),
        unitKey: entry.unit.key,
        unitLabel: entry.unit.instrumentName,
        studentsAffected: entry.unit.studentsAssessed,
      });
    }
    return drafts;
  }

  private async itemGapAlerts(tx: Database, units: ComparableUnitSummary[]): Promise<AlertDraft[]> {
    const assessmentIds = units.flatMap((u) => u.assessmentIds);
    if (assessmentIds.length === 0) return [];

    const rows = await tx
      .select({
        assessmentId: assessmentItemStats.assessmentId,
        itemId: assessmentItemStats.itemId,
        position: items.position,
        correct: sql<number>`sum(${assessmentItemStats.correctCount})::int`,
        responses: sql<number>`sum(${assessmentItemStats.responseCount})::int`,
      })
      .from(assessmentItemStats)
      .innerJoin(items, eq(items.id, assessmentItemStats.itemId))
      .where(
        and(
          inArray(assessmentItemStats.assessmentId, assessmentIds),
          inArray(sql`${items.type}::text`, [...AUTO_SCORABLE_ITEM_TYPES]),
        ),
      )
      .groupBy(assessmentItemStats.assessmentId, assessmentItemStats.itemId, items.position);

    const unitByAssessment = new Map<string, ComparableUnitSummary>();
    for (const unit of units) {
      for (const id of unit.assessmentIds) unitByAssessment.set(id, unit);
    }

    const byUnitItem = new Map<
      string,
      {
        unit: ComparableUnitSummary;
        itemId: string;
        label: string;
        correct: number;
        responses: number;
      }
    >();
    for (const row of rows) {
      const unit = unitByAssessment.get(row.assessmentId);
      if (!unit) continue;
      const key = `${unit.key}:${row.itemId}`;
      const entry = byUnitItem.get(key) ?? {
        unit,
        itemId: row.itemId,
        label: row.position ? `Pregunta ${row.position}` : 'Una pregunta',
        correct: 0,
        responses: 0,
      };
      entry.correct += Number(row.correct ?? 0);
      entry.responses += Number(row.responses ?? 0);
      byUnitItem.set(key, entry);
    }

    const drafts: AlertDraft[] = [];
    for (const entry of byUnitItem.values()) {
      if (entry.responses === 0) continue;
      const rate = (entry.correct / entry.responses) * 100;
      const severity = inverseThresholdSeverity(rate, ALERT_THRESHOLDS.itemCorrectRate);
      if (!severity) continue;
      drafts.push({
        type: 'item_gap',
        severity,
        message: `${entry.label} de ${entry.unit.instrumentName}: sólo ${rate.toFixed(0)}% de acierto`,
        contextKind: 'item',
        contextId: entry.itemId,
        contextLabel: entry.label,
        value: Number(rate.toFixed(1)),
        unitKey: entry.unit.key,
        unitLabel: entry.unit.instrumentName,
        studentsAffected: entry.responses,
      });
    }
    return drafts;
  }

  private async bandRegressionAlerts(
    tx: Database,
    units: ComparableUnitSummary[],
  ): Promise<AlertDraft[]> {
    const assessmentIds = units.flatMap((u) => u.assessmentIds);
    if (assessmentIds.length === 0) return [];

    const currentBand = alias(performanceBands, 'current_band');
    const priorBand = alias(performanceBands, 'prior_band');
    const scoped = scopedAssessmentResults(tx, assessmentIds);
    const assessmentYear = assessmentAcademicYears(tx);

    const rows = await tx
      .select({
        assessmentId: scoped.assessmentId,
        classGroupId: classGroups.id,
        classGroupName: classGroups.name,
        dropped: sql<number>`count(*)::int`,
      })
      .from(scoped)
      .innerJoin(currentBand, eq(currentBand.id, scoped.performanceBandId))
      .innerJoin(priorBand, eq(priorBand.id, scoped.priorPerformanceBandId))
      .innerJoin(assessmentYear, eq(assessmentYear.assessmentId, scoped.assessmentId))
      .innerJoin(
        studentEnrollments,
        and(
          eq(studentEnrollments.studentId, scoped.studentId),
          eq(studentEnrollments.academicYearId, assessmentYear.academicYearId),
        ),
      )
      .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
      .where(and(isNotNull(scoped.priorPerformanceBandId), lt(currentBand.order, priorBand.order)))
      .groupBy(scoped.assessmentId, classGroups.id, classGroups.name);

    const unitByAssessment = new Map<string, ComparableUnitSummary>();
    for (const unit of units) {
      for (const id of unit.assessmentIds) unitByAssessment.set(id, unit);
    }

    const drafts: AlertDraft[] = [];
    for (const row of rows) {
      const unit = unitByAssessment.get(row.assessmentId);
      const dropped = Number(row.dropped ?? 0);
      if (!unit || dropped === 0) continue;
      drafts.push({
        type: 'band_regression',
        severity: dropped >= 5 ? 'high' : 'medium',
        message: `${row.classGroupName}: ${dropped} ${dropped === 1 ? 'alumno bajó' : 'alumnos bajaron'} de nivel respecto del momento anterior en ${unit.instrumentName}`,
        contextKind: 'class_group',
        contextId: row.classGroupId,
        contextLabel: row.classGroupName,
        value: dropped,
        unitKey: unit.key,
        unitLabel: unit.instrumentName,
        studentsAffected: dropped,
      });
    }
    return drafts;
  }

  private async coverageAlerts(
    tx: Database,
    orgId: string,
    units: ComparableUnitSummary[],
    classGroupIds: string[] | null,
  ): Promise<AlertDraft[]> {
    const assessmentIds = units.flatMap((u) => u.assessmentIds);
    if (assessmentIds.length === 0) return [];

    const assignedConditions = [
      inArray(assessmentCourseAssignments.assessmentId, assessmentIds),
      eq(classGroups.orgId, orgId),
    ];
    if (classGroupIds !== null) {
      if (classGroupIds.length === 0) return [];
      assignedConditions.push(inArray(classGroups.id, classGroupIds));
    }

    const assigned = await tx
      .select({
        assessmentId: assessmentCourseAssignments.assessmentId,
        classGroupId: classGroups.id,
        classGroupName: classGroups.name,
      })
      .from(assessmentCourseAssignments)
      .innerJoin(classGroups, eq(classGroups.id, assessmentCourseAssignments.classGroupId))
      .where(and(...assignedConditions));

    const coverageAssessmentYear = assessmentAcademicYears(tx);
    const coverageScoped = scopedAssessmentResults(tx, assessmentIds);
    const withResults = await tx
      .selectDistinct({
        assessmentId: coverageScoped.assessmentId,
        classGroupId: studentEnrollments.classGroupId,
      })
      .from(coverageScoped)
      .innerJoin(
        coverageAssessmentYear,
        eq(coverageAssessmentYear.assessmentId, coverageScoped.assessmentId),
      )
      .innerJoin(
        studentEnrollments,
        and(
          eq(studentEnrollments.studentId, coverageScoped.studentId),
          eq(studentEnrollments.academicYearId, coverageAssessmentYear.academicYearId),
        ),
      );

    const covered = new Set(withResults.map((r) => `${r.assessmentId}:${r.classGroupId}`));
    const unitByAssessment = new Map<string, ComparableUnitSummary>();
    for (const unit of units) {
      for (const id of unit.assessmentIds) unitByAssessment.set(id, unit);
    }

    const missingByUnit = new Map<string, { unit: ComparableUnitSummary; courses: string[] }>();
    for (const row of assigned) {
      if (covered.has(`${row.assessmentId}:${row.classGroupId}`)) continue;
      const unit = unitByAssessment.get(row.assessmentId);
      if (!unit) continue;
      const entry = missingByUnit.get(unit.key) ?? { unit, courses: [] };
      if (!entry.courses.includes(row.classGroupName)) entry.courses.push(row.classGroupName);
      missingByUnit.set(unit.key, entry);
    }

    const drafts: AlertDraft[] = [];
    for (const entry of missingByUnit.values()) {
      drafts.push({
        type: 'coverage_gap',
        severity: entry.courses.length > 1 ? 'high' : 'medium',
        message: `${entry.unit.instrumentName}: ${entry.courses.length} ${entry.courses.length === 1 ? 'curso asignado sin resultados' : 'cursos asignados sin resultados'} (${entry.courses.slice(0, 3).join(', ')})`,
        contextKind: 'assessment',
        contextId: entry.unit.assessmentIds[0] ?? null,
        contextLabel: entry.unit.instrumentName,
        value: entry.courses.length,
        unitKey: entry.unit.key,
        unitLabel: entry.unit.instrumentName,
        studentsAffected: null,
      });
    }

    drafts.push(...(await this.staleAssessmentAlerts(tx, orgId, units)));
    return drafts;
  }

  private async staleAssessmentAlerts(
    tx: Database,
    orgId: string,
    units: ComparableUnitSummary[],
  ): Promise<AlertDraft[]> {
    const assessmentIds = units.flatMap((u) => u.assessmentIds);
    if (assessmentIds.length === 0) return [];

    const rows = await tx
      .select({
        assessmentId: assessments.id,
        administeredAt: assessments.administeredAt,
      })
      .from(assessments)
      .where(
        and(
          eq(assessments.orgId, orgId),
          inArray(assessments.id, assessmentIds),
          ne(assessments.status, 'completed'),
          ne(assessments.status, 'cancelled'),
          isNotNull(assessments.administeredAt),
          lt(
            assessments.administeredAt,
            sql`now() - ${sql.raw(`interval '${ALERT_THRESHOLDS.staleAssessmentDays} days'`)}`,
          ),
        ),
      );

    const unitByAssessment = new Map<string, ComparableUnitSummary>();
    for (const unit of units) {
      for (const id of unit.assessmentIds) unitByAssessment.set(id, unit);
    }

    return rows.flatMap((row) => {
      const unit = unitByAssessment.get(row.assessmentId);
      if (!unit) return [];
      return [
        {
          type: 'stale_assessment' as const,
          severity: 'medium' as AlertSeverity,
          message: `${unit.instrumentName} se aplicó hace más de ${ALERT_THRESHOLDS.staleAssessmentDays} días y sigue sin cerrarse`,
          contextKind: 'assessment' as const,
          contextId: row.assessmentId,
          contextLabel: unit.instrumentName,
          value: null,
          unitKey: unit.key,
          unitLabel: unit.instrumentName,
          studentsAffected: null,
        },
      ];
    });
  }
}

/** Un banner no puede llevar un nombre de nodo de un párrafo entero. */
function shorten(text: string, max = 80): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function severityRank(severity: AlertSeverity): number {
  return severity === 'high' ? 0 : severity === 'medium' ? 1 : 2;
}

function thresholdSeverity(
  value: number | null,
  thresholds: { high: number; medium: number },
): AlertSeverity | null {
  if (value == null) return null;
  if (value >= thresholds.high) return 'high';
  if (value >= thresholds.medium) return 'medium';
  return null;
}

function inverseThresholdSeverity(
  value: number | null,
  thresholds: { high: number; medium: number },
): AlertSeverity | null {
  if (value == null) return null;
  if (value <= thresholds.high) return 'high';
  if (value <= thresholds.medium) return 'medium';
  return null;
}
