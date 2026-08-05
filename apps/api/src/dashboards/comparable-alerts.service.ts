import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  assessmentCourseAssignments,
  assessmentItemStats,
  assessmentResults,
  assessmentSkillStats,
  assessments,
  classGroups,
  items,
  performanceBands,
  studentEnrollments,
  students,
  taxonomyNodes,
} from '@soe/db';
import {
  ALERT_THRESHOLDS,
  AUTO_SCORED_ITEM_TYPES,
  ALERT_HIDDEN_NODE_TYPES,
  type AlertSeverity,
  type ComparableUnitSummary,
  type DashboardAlert,
} from '@soe/types';
import type { Database } from '../database/database.types';

type AlertDraft = Omit<DashboardAlert, 'dedupKey'> & { dedupKey?: string };

@Injectable()
export class ComparableAlertsService {
  async deriveAlerts(
    tx: Database,
    orgId: string,
    units: ComparableUnitSummary[],
    classGroupIds: string[] | null,
  ): Promise<DashboardAlert[]> {
    if (units.length === 0) return [];

    const drafts: AlertDraft[] = [
      ...this.bandConcentrationAlerts(units),
      ...this.movementAlerts(units),
      ...this.classBelowUnitAlerts(units),
      ...(await this.skillGapAlerts(tx, units)),
      ...(await this.itemGapAlerts(tx, units)),
      ...(await this.bandRegressionAlerts(tx, units)),
      ...(await this.coverageAlerts(tx, orgId, units, classGroupIds)),
    ];

    return this.dedupeAndRank(drafts);
  }

  private dedupeAndRank(drafts: AlertDraft[]): DashboardAlert[] {
    const byKey = new Map<string, DashboardAlert>();
    for (const draft of drafts) {
      const dedupKey =
        draft.dedupKey ?? `${draft.type}:${draft.unitKey ?? '-'}:${draft.contextId ?? '-'}`;
      if (byKey.has(dedupKey)) continue;
      byKey.set(dedupKey, { ...draft, dedupKey });
    }

    return Array.from(byKey.values()).sort((a, b) => {
      const bySeverity = severityRank(a.severity) - severityRank(b.severity);
      if (bySeverity !== 0) return bySeverity;
      return (b.studentsAffected ?? 0) - (a.studentsAffected ?? 0);
    });
  }

  private bandConcentrationAlerts(units: ComparableUnitSummary[]): AlertDraft[] {
    const drafts: AlertDraft[] = [];
    for (const unit of units) {
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

  private async skillGapAlerts(
    tx: Database,
    units: ComparableUnitSummary[],
  ): Promise<AlertDraft[]> {
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

    const drafts: AlertDraft[] = [];
    for (const entry of byUnitNode.values()) {
      if (entry.total === 0 || entry.unit.averageAchievement == null) continue;
      const achievement = (entry.correct / entry.total) * 100;
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
          inArray(sql`${items.type}::text`, [...AUTO_SCORED_ITEM_TYPES]),
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

    const rows = await tx
      .select({
        assessmentId: assessmentResults.assessmentId,
        classGroupId: classGroups.id,
        classGroupName: classGroups.name,
        dropped: sql<number>`count(*)::int`,
      })
      .from(assessmentResults)
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .innerJoin(currentBand, eq(currentBand.id, assessmentResults.performanceBandId))
      .innerJoin(priorBand, eq(priorBand.id, assessmentResults.priorPerformanceBandId))
      .innerJoin(studentEnrollments, eq(studentEnrollments.studentId, assessmentResults.studentId))
      .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
      .where(
        and(
          inArray(assessmentResults.assessmentId, assessmentIds),
          isNull(students.deletedAt),
          isNotNull(assessmentResults.priorPerformanceBandId),
          lt(currentBand.order, priorBand.order),
        ),
      )
      .groupBy(assessmentResults.assessmentId, classGroups.id, classGroups.name);

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

    const withResults = await tx
      .selectDistinct({
        assessmentId: assessmentResults.assessmentId,
        classGroupId: studentEnrollments.classGroupId,
      })
      .from(assessmentResults)
      .innerJoin(studentEnrollments, eq(studentEnrollments.studentId, assessmentResults.studentId))
      .where(inArray(assessmentResults.assessmentId, assessmentIds));

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
