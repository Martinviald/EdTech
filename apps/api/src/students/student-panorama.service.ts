import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import {
  academicYears,
  classGroups,
  grades,
  skillResults,
  studentEnrollments,
  students,
  taxonomyNodes,
  withOrgContext,
} from '@soe/db';
import {
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  RESULT_HIDDEN_NODE_TYPES,
  bandToLegacyLevel,
  buildComparabilityMeta,
  classifyByBands,
  percentageToPerformanceLevel,
  type ComparabilityInstrumentRef,
  type InstrumentApplicationPeriod,
  type PerformanceBandInput,
  type PerformanceBandView,
  type StudentPanoramaAppliedFilters,
  type StudentPanoramaAssessment,
  type StudentPanoramaFilterOptions,
  type StudentPanoramaHeader,
  type StudentPanoramaQueryDto,
  type StudentPanoramaResponse,
  type StudentPanoramaSeries,
  type StudentPanoramaSeriesPoint,
  type StudentPanoramaSkill,
  type StudentPanoramaSkillNode,
  type StudentPanoramaSubject,
  type StudentPanoramaSummary,
  type StudentSkillTrendPoint,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import {
  isStudentVisibleInScope,
  resolveClassGroupScope,
  resolveStudentSubjectFilter,
} from '../common/helpers/class-group-scope.helper';
import { resolveEffectiveBandsForInstruments } from '../performance-bands/lib/resolve-effective-bands';
import { loadStudentAssessments } from './lib/load-student-assessments';
import { buildTree } from '../taxonomies/lib/tree-builder';

type SkillWithOrder = StudentPanoramaSkill & { nodeOrder: number };

const MIN_SERIES_POINTS = 2;

function compareSkillsByAchievement(a: StudentPanoramaSkill, b: StudentPanoramaSkill): number {
  if (a.achievement === null) return b.achievement === null ? 0 : 1;
  if (b.achievement === null) return -1;
  return a.achievement - b.achievement || a.nodeName.localeCompare(b.nodeName, 'es');
}

function bandInputToView(band: PerformanceBandInput): PerformanceBandView {
  return { key: band.key, label: band.label, order: band.order, color: band.color ?? null };
}

function toInstrumentRef(a: StudentPanoramaAssessment): ComparabilityInstrumentRef {
  return {
    instrumentId: a.instrumentId,
    type: a.instrumentType,
    subjectId: a.subjectId,
    gradeId: a.gradeId,
    applicationPeriod: a.applicationPeriod,
    year: a.year,
  };
}

function uniqueInstrumentRefs(rows: StudentPanoramaAssessment[]): ComparabilityInstrumentRef[] {
  const byId = new Map<string, ComparabilityInstrumentRef>();
  for (const row of rows) {
    if (!byId.has(row.instrumentId)) byId.set(row.instrumentId, toInstrumentRef(row));
  }
  return [...byId.values()];
}

function toSeriesPoint(a: StudentPanoramaAssessment, label: string): StudentPanoramaSeriesPoint {
  return {
    assessmentId: a.assessmentId,
    label,
    instrumentName: a.instrumentName,
    administeredAt: a.administeredAt,
    achievement: a.achievement,
    performanceBand: a.performanceBand,
    performanceLevel: a.performanceLevel,
  };
}

function periodLabel(period: InstrumentApplicationPeriod | null): string {
  return period ? INSTRUMENT_APPLICATION_PERIOD_LABELS[period] : 'Sin momento';
}

function meanAchievement(rows: StudentPanoramaAssessment[]): number | null {
  const withPct = rows.filter((a) => a.achievement !== null);
  if (withPct.length === 0) return null;
  return withPct.reduce((acc, a) => acc + (a.achievement ?? 0), 0) / withPct.length;
}

@Injectable()
export class StudentPanoramaService {
  constructor(@InjectDb() private readonly db: Database) {}

  async getPanorama(
    user: JwtPayload,
    studentId: string,
    query: StudentPanoramaQueryDto = {},
  ): Promise<StudentPanoramaResponse> {
    const orgId = user.orgId;
    if (orgId === null) {
      throw new ForbiddenException('Usuario sin organización activa');
    }

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await resolveClassGroupScope(tx, user, orgId);
      const visible = await isStudentVisibleInScope(tx, orgId, scope, studentId);
      if (!visible) {
        throw new NotFoundException('Estudiante no encontrado');
      }

      const student = await this.loadStudentHeader(tx, orgId, studentId);
      if (!student) {
        throw new NotFoundException('Estudiante no encontrado');
      }

      // Alcance por asignatura: de un alumno visible, un profesor de asignatura
      // sólo ve lo suyo; el profesor jefe ve el perfil completo del alumno
      // (docs/diseno-alcance-docente.md §3.1).
      const subjectFilter = await resolveStudentSubjectFilter(tx, scope, studentId);
      const rawAssessments = (await loadStudentAssessments(tx, orgId, studentId)).filter(
        (a) => subjectFilter === null || (a.subjectId !== null && subjectFilter.has(a.subjectId)),
      );
      const effectiveBands = await resolveEffectiveBandsForInstruments(tx, [
        ...new Set(rawAssessments.map((a) => a.instrumentId)),
      ]);
      const allAssessments = this.applyEffectiveBands(rawAssessments, effectiveBands);

      const filterOptions = this.buildFilterOptions(allAssessments);
      const filters = this.resolveFilters(query, allAssessments);
      const byAssessment = this.applyFilters(allAssessments, filters);

      const assessmentIds = byAssessment.map((a) => a.assessmentId);
      const skillRows = await this.loadBySkill(tx, studentId, assessmentIds);
      const skillSeries = await this.loadSkillSeries(tx, studentId, assessmentIds);

      const comparability = buildComparabilityMeta(
        uniqueInstrumentRefs(byAssessment),
        byAssessment.length,
      );
      const bySkillTree = this.buildSkillTree(skillRows, byAssessment, skillSeries);
      const bySkill = skillRows.map(({ nodeOrder: _nodeOrder, ...skill }) => skill);
      const bySubject = this.buildBySubject(byAssessment);
      const summary = this.buildSummary(byAssessment, bySkill, comparability.aggregatable);

      return {
        student,
        filters,
        filterOptions,
        comparability,
        bySubject,
        summary,
        byAssessment,
        bySkill,
        bySkillTree,
      };
    });
  }

  private async loadStudentHeader(
    tx: Database,
    orgId: string,
    studentId: string,
  ): Promise<StudentPanoramaHeader | null> {
    const [row] = await tx
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        rut: students.rut,
      })
      .from(students)
      .where(and(eq(students.id, studentId), eq(students.orgId, orgId), isNull(students.deletedAt)))
      .limit(1);
    if (!row) return null;

    const [enrollment] = await tx
      .select({
        classGroupId: classGroups.id,
        classGroupName: classGroups.name,
        gradeName: grades.name,
      })
      .from(studentEnrollments)
      .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
      .innerJoin(grades, eq(grades.id, classGroups.gradeId))
      .innerJoin(academicYears, eq(academicYears.id, classGroups.academicYearId))
      .where(and(eq(studentEnrollments.studentId, studentId), eq(classGroups.orgId, orgId)))
      .orderBy(desc(academicYears.year))
      .limit(1);

    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      fullName: `${row.firstName} ${row.lastName}`.trim(),
      rut: row.rut,
      classGroup: enrollment
        ? {
            id: enrollment.classGroupId,
            name: enrollment.classGroupName,
            gradeName: enrollment.gradeName,
          }
        : null,
    };
  }

  private applyEffectiveBands(
    rows: StudentPanoramaAssessment[],
    effectiveBands: ReadonlyMap<string, { bands: PerformanceBandInput[] }>,
  ): StudentPanoramaAssessment[] {
    return rows.map((row) => {
      if (row.performanceBand !== null || row.achievement === null) return row;
      const bands = effectiveBands.get(row.instrumentId)?.bands;
      if (!bands || bands.length === 0) return row;
      const band = classifyByBands(row.achievement / 100, bands);
      if (!band) return row;
      return {
        ...row,
        performanceBand: bandInputToView(band),
        performanceLevel: bandToLegacyLevel(band, bands),
      };
    });
  }

  private buildFilterOptions(rows: StudentPanoramaAssessment[]): StudentPanoramaFilterOptions {
    const subjects = new Map<string, { id: string | null; name: string | null }>();
    const instrumentTypes = new Set<string>();
    const years = new Set<number>();
    const periods = new Set<InstrumentApplicationPeriod>();

    for (const row of rows) {
      subjects.set(row.subjectId ?? '', { id: row.subjectId, name: row.subjectName });
      instrumentTypes.add(row.instrumentType);
      if (row.year !== null) years.add(row.year);
      if (row.applicationPeriod !== null) periods.add(row.applicationPeriod);
    }

    return {
      subjects: [...subjects.values()].sort((a, b) =>
        (a.name ?? '').localeCompare(b.name ?? '', 'es'),
      ),
      instrumentTypes: [...instrumentTypes].sort(),
      years: [...years].sort((a, b) => b - a),
      applicationPeriods: [...periods],
    };
  }

  private resolveFilters(
    query: StudentPanoramaQueryDto,
    rows: StudentPanoramaAssessment[],
  ): StudentPanoramaAppliedFilters {
    const allYears = query.allYears === true;
    const declaredYears = rows.map((r) => r.year).filter((y): y is number => y !== null);
    const latestYear = declaredYears.length > 0 ? Math.max(...declaredYears) : null;
    const year = allYears ? null : (query.year ?? latestYear);

    return {
      subjectId: query.subjectId ?? null,
      instrumentType: query.instrumentType ?? null,
      applicationPeriod: query.applicationPeriod ?? null,
      year,
      allYears,
    };
  }

  private applyFilters(
    rows: StudentPanoramaAssessment[],
    filters: StudentPanoramaAppliedFilters,
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

  private async loadBySkill(
    tx: Database,
    studentId: string,
    assessmentIds: string[],
  ): Promise<SkillWithOrder[]> {
    if (assessmentIds.length === 0) return [];

    const rows = await tx
      .select({
        nodeId: skillResults.nodeId,
        nodeName: taxonomyNodes.name,
        nodeType: taxonomyNodes.type,
        nodeCode: taxonomyNodes.code,
        parentNodeId: taxonomyNodes.parentId,
        nodeOrder: taxonomyNodes.order,
        correctCount: sql<number>`sum(${skillResults.correctCount})::int`,
        totalCount: sql<number>`sum(${skillResults.totalCount})::int`,
        assessmentsCount: sql<number>`count(distinct ${skillResults.assessmentId})::int`,
      })
      .from(skillResults)
      .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, skillResults.nodeId))
      .where(
        and(
          eq(skillResults.studentId, studentId),
          inArray(skillResults.assessmentId, assessmentIds),
          notInArray(taxonomyNodes.type, [...RESULT_HIDDEN_NODE_TYPES]),
        ),
      )
      .groupBy(
        skillResults.nodeId,
        taxonomyNodes.name,
        taxonomyNodes.type,
        taxonomyNodes.code,
        taxonomyNodes.parentId,
        taxonomyNodes.order,
      )
      .orderBy(asc(taxonomyNodes.name));

    return rows
      .map((r) => {
        const correctCount = Number(r.correctCount ?? 0);
        const totalCount = Number(r.totalCount ?? 0);
        const achievement = totalCount > 0 ? (correctCount / totalCount) * 100 : null;
        return {
          nodeId: r.nodeId,
          nodeName: r.nodeName,
          nodeType: r.nodeType,
          nodeCode: r.nodeCode,
          parentNodeId: r.parentNodeId,
          nodeOrder: r.nodeOrder,
          achievement,
          correctCount,
          totalCount,
          assessmentsCount: Number(r.assessmentsCount ?? 0),
          performanceLevel:
            achievement === null ? null : percentageToPerformanceLevel(achievement / 100),
        };
      })
      .sort(compareSkillsByAchievement);
  }

  private async loadSkillSeries(
    tx: Database,
    studentId: string,
    assessmentIds: string[],
  ): Promise<Map<string, Map<string, number | null>>> {
    const byNode = new Map<string, Map<string, number | null>>();
    if (assessmentIds.length === 0) return byNode;

    const rows = await tx
      .select({
        assessmentId: skillResults.assessmentId,
        nodeId: skillResults.nodeId,
        percentage: skillResults.percentage,
      })
      .from(skillResults)
      .where(
        and(
          eq(skillResults.studentId, studentId),
          inArray(skillResults.assessmentId, assessmentIds),
        ),
      );

    for (const row of rows) {
      let byAssessment = byNode.get(row.nodeId);
      if (!byAssessment) {
        byAssessment = new Map<string, number | null>();
        byNode.set(row.nodeId, byAssessment);
      }
      byAssessment.set(row.assessmentId, row.percentage === null ? null : Number(row.percentage));
    }

    return byNode;
  }

  private buildSkillTree(
    bySkill: SkillWithOrder[],
    byAssessment: StudentPanoramaAssessment[],
    skillSeries: Map<string, Map<string, number | null>>,
  ): StudentPanoramaSkillNode[] {
    const assessmentLabels = new Map<string, string>();
    for (const a of byAssessment) {
      assessmentLabels.set(
        a.assessmentId,
        `${periodLabel(a.applicationPeriod)}${a.year === null ? '' : ` ${a.year}`}`,
      );
    }

    const seriesForNode = (nodeId: string): StudentSkillTrendPoint[] => {
      const byAssessmentPct = skillSeries.get(nodeId);
      if (!byAssessmentPct) return [];
      const points: StudentSkillTrendPoint[] = [];
      for (const a of byAssessment) {
        if (!byAssessmentPct.has(a.assessmentId)) continue;
        points.push({
          assessmentId: a.assessmentId,
          label: assessmentLabels.get(a.assessmentId) ?? 'Sin momento',
          achievement: byAssessmentPct.get(a.assessmentId) ?? null,
        });
      }
      return points;
    };

    const tree = buildTree(
      bySkill.map((s) => ({ ...s, id: s.nodeId, parentId: s.parentNodeId, order: s.nodeOrder })),
    );
    const strip = (node: (typeof tree)[number]): StudentPanoramaSkillNode => ({
      nodeId: node.nodeId,
      nodeName: node.nodeName,
      nodeType: node.nodeType,
      nodeCode: node.nodeCode,
      parentNodeId: node.parentNodeId,
      achievement: node.achievement,
      correctCount: node.correctCount,
      totalCount: node.totalCount,
      assessmentsCount: node.assessmentsCount,
      performanceLevel: node.performanceLevel,
      series: seriesForNode(node.nodeId),
      children: node.children.map(strip),
    });
    return tree.map(strip);
  }

  private buildBySubject(rows: StudentPanoramaAssessment[]): StudentPanoramaSubject[] {
    const grouped = new Map<string, StudentPanoramaAssessment[]>();
    for (const row of rows) {
      const key = row.subjectId ?? '';
      const bucket = grouped.get(key);
      if (bucket) bucket.push(row);
      else grouped.set(key, [row]);
    }

    const subjects: StudentPanoramaSubject[] = [];
    for (const group of grouped.values()) {
      const comparability = buildComparabilityMeta(uniqueInstrumentRefs(group), group.length);
      const latest = group[group.length - 1];
      subjects.push({
        subjectId: latest?.subjectId ?? null,
        subjectName: latest?.subjectName ?? null,
        assessmentsCount: group.length,
        achievement: comparability.aggregatable ? meanAchievement(group) : null,
        comparability,
        latest: latest ? toSeriesPoint(latest, periodLabel(latest.applicationPeriod)) : null,
        series: this.buildSeries(group),
      });
    }

    return subjects.sort((a, b) =>
      (a.subjectName ?? 'zzz').localeCompare(b.subjectName ?? 'zzz', 'es'),
    );
  }

  private buildSeries(rows: StudentPanoramaAssessment[]): StudentPanoramaSeries[] {
    const byPeriodSeries = new Map<string, StudentPanoramaAssessment[]>();
    const byFamily = new Map<string, StudentPanoramaAssessment[]>();

    for (const row of rows) {
      const periodBucket = byPeriodSeries.get(row.periodSeriesKey);
      if (periodBucket) periodBucket.push(row);
      else byPeriodSeries.set(row.periodSeriesKey, [row]);

      const familyBucket = byFamily.get(row.familyKey);
      if (familyBucket) familyBucket.push(row);
      else byFamily.set(row.familyKey, [row]);
    }

    const series: StudentPanoramaSeries[] = [];

    for (const [key, group] of byPeriodSeries) {
      if (group.length < MIN_SERIES_POINTS) continue;
      const year = group[0]?.year;
      series.push({
        kind: 'period_series',
        key,
        label: year === null || year === undefined ? 'Momentos del ciclo' : `Momentos ${year}`,
        points: group.map((a) => toSeriesPoint(a, periodLabel(a.applicationPeriod))),
      });
    }

    for (const [key, group] of byFamily) {
      if (group.length < MIN_SERIES_POINTS) continue;
      const sorted = [...group].sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
      series.push({
        kind: 'instrument_family',
        key,
        label: `${periodLabel(sorted[0]?.applicationPeriod ?? null)} año a año`,
        points: sorted.map((a) => toSeriesPoint(a, a.year === null ? 'Sin año' : String(a.year))),
      });
    }

    return series;
  }

  private buildSummary(
    byAssessment: StudentPanoramaAssessment[],
    bySkill: StudentPanoramaSkill[],
    aggregatable: boolean,
  ): StudentPanoramaSummary {
    const withAchievement = byAssessment.filter((a) => a.achievement !== null).length;
    return {
      assessmentsCount: byAssessment.length,
      averageAchievement: aggregatable ? meanAchievement(byAssessment) : null,
      assessmentsWithAchievement: withAchievement,
      skillsAssessed: bySkill.length,
    };
  }
}
