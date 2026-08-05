import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  academicYears,
  assessmentResults,
  assessments,
  classGroups,
  grades,
  instruments,
  performanceBands,
  skillResults,
  studentEnrollments,
  students,
  subjects,
  taxonomyNodes,
  withOrgContext,
} from '@soe/db';
import {
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  PERFORMANCE_LEVELS,
  RESULT_HIDDEN_NODE_TYPES,
  buildComparabilityMeta,
  buildInstrumentFamilyKey,
  buildPeriodSeriesKey,
  percentageToPerformanceLevel,
  type ComparabilityInstrumentRef,
  type DataGranularity,
  type InstrumentApplicationPeriod,
  type PerformanceBandInput,
  type PerformanceBandView,
  type PerformanceDistributionBucket,
  type PerformanceLevel,
  type StudentPanoramaAppliedFilters,
  type StudentPanoramaAssessment,
  type StudentPanoramaDistribution,
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
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import {
  isStudentVisibleInScope,
  resolveClassGroupScope,
} from '../common/helpers/class-group-scope.helper';
import { loadBandsForInstruments } from '../performance-bands/lib/load-instrument-bands';
import { buildTree } from '../taxonomies/lib/tree-builder';

type SkillWithOrder = StudentPanoramaSkill & { nodeOrder: number };

const MIN_SERIES_POINTS = 2;

function compareSkillsByAchievement(a: StudentPanoramaSkill, b: StudentPanoramaSkill): number {
  if (a.achievement === null) return b.achievement === null ? 0 : 1;
  if (b.achievement === null) return -1;
  return a.achievement - b.achievement || a.nodeName.localeCompare(b.nodeName, 'es');
}

function toBandView(r: {
  bandKey: string | null;
  bandLabel: string | null;
  bandOrder: number | null;
  bandColor: string | null;
}): PerformanceBandView | null {
  if (r.bandKey === null || r.bandLabel === null || r.bandOrder === null) return null;
  return { key: r.bandKey, label: r.bandLabel, order: r.bandOrder, color: r.bandColor };
}

function bandsToViews(bands: readonly PerformanceBandInput[]): PerformanceBandView[] {
  return bands.map((b) => ({ key: b.key, label: b.label, order: b.order, color: b.color ?? null }));
}

function scaleSignature(bands: readonly PerformanceBandInput[]): string {
  return bands
    .map((b) => `${b.order}:${b.key}`)
    .sort()
    .join('|');
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

      const allAssessments = await this.loadByAssessment(tx, orgId, studentId);
      const filterOptions = this.buildFilterOptions(allAssessments);
      const filters = this.resolveFilters(query, allAssessments);
      const byAssessment = this.applyFilters(allAssessments, filters);

      const skillRows = await this.loadBySkill(
        tx,
        studentId,
        byAssessment.map((a) => a.assessmentId),
      );
      const bandsByInstrument = await loadBandsForInstruments(tx, [
        ...new Set(byAssessment.map((a) => a.instrumentId)),
      ]);

      const comparability = buildComparabilityMeta(
        uniqueInstrumentRefs(byAssessment),
        byAssessment.length,
      );
      const bySkillTree = this.buildSkillTree(skillRows);
      const bySkill = skillRows.map(({ nodeOrder: _nodeOrder, ...skill }) => skill);
      const bySubject = this.buildBySubject(byAssessment);
      const distribution = this.buildDistribution(byAssessment, bandsByInstrument);
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
        distribution,
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

  private async loadByAssessment(
    tx: Database,
    orgId: string,
    studentId: string,
  ): Promise<StudentPanoramaAssessment[]> {
    const priorBands = alias(performanceBands, 'prior_performance_bands');

    const rows = await tx
      .select({
        assessmentId: assessments.id,
        assessmentName: assessments.name,
        instrumentId: instruments.id,
        instrumentName: instruments.name,
        instrumentType: instruments.type,
        subjectId: instruments.subjectId,
        subjectName: subjects.name,
        gradeId: instruments.gradeId,
        year: instruments.year,
        applicationPeriod: instruments.applicationPeriod,
        administeredAt: assessments.administeredAt,
        dataGranularity: assessments.dataGranularity,
        achievement: assessmentResults.percentage,
        grade: assessmentResults.grade,
        performanceLevel: assessmentResults.performanceLevel,
        bandKey: performanceBands.key,
        bandLabel: performanceBands.label,
        bandOrder: performanceBands.order,
        bandColor: performanceBands.color,
        priorBandKey: priorBands.key,
        priorBandLabel: priorBands.label,
        priorBandOrder: priorBands.order,
        priorBandColor: priorBands.color,
      })
      .from(assessmentResults)
      .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
      .leftJoin(performanceBands, eq(performanceBands.id, assessmentResults.performanceBandId))
      .leftJoin(priorBands, eq(priorBands.id, assessmentResults.priorPerformanceBandId))
      .where(
        and(
          eq(assessmentResults.studentId, studentId),
          eq(assessments.orgId, orgId),
          isNull(instruments.deletedAt),
        ),
      )
      .orderBy(asc(assessments.administeredAt), asc(assessments.createdAt));

    return rows.map((r) => {
      const ref: ComparabilityInstrumentRef = {
        instrumentId: r.instrumentId,
        type: r.instrumentType,
        subjectId: r.subjectId,
        gradeId: r.gradeId,
        applicationPeriod: r.applicationPeriod,
        year: r.year,
      };
      return {
        assessmentId: r.assessmentId,
        assessmentName: r.assessmentName,
        instrumentId: r.instrumentId,
        instrumentName: r.instrumentName,
        instrumentType: r.instrumentType,
        subjectId: r.subjectId,
        subjectName: r.subjectName,
        gradeId: r.gradeId,
        year: r.year,
        applicationPeriod: r.applicationPeriod,
        familyKey: buildInstrumentFamilyKey(ref),
        periodSeriesKey: buildPeriodSeriesKey(ref),
        administeredAt: r.administeredAt,
        dataGranularity: r.dataGranularity as DataGranularity,
        achievement: r.achievement === null ? null : Number(r.achievement),
        grade: r.grade,
        performanceLevel: r.performanceLevel,
        performanceBand: toBandView(r),
        priorPerformanceBand: toBandView({
          bandKey: r.priorBandKey,
          bandLabel: r.priorBandLabel,
          bandOrder: r.priorBandOrder,
          bandColor: r.priorBandColor,
        }),
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

  private buildSkillTree(bySkill: SkillWithOrder[]): StudentPanoramaSkillNode[] {
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

  private buildDistribution(
    byAssessment: StudentPanoramaAssessment[],
    bandsByInstrument: Map<string, PerformanceBandInput[]>,
  ): StudentPanoramaDistribution {
    const signatureBands = new Map<string, PerformanceBandInput[]>();
    const bandCounts = new Map<string, Map<string, number>>();
    const levelCounts = new Map<PerformanceLevel, number>();
    let classified = 0;

    for (const a of byAssessment) {
      if (a.performanceBand) {
        const bands = bandsByInstrument.get(a.instrumentId) ?? [];
        const signature = bands.length > 0 ? scaleSignature(bands) : a.performanceBand.key;
        if (!signatureBands.has(signature)) signatureBands.set(signature, bands);
        const counts = bandCounts.get(signature) ?? new Map<string, number>();
        counts.set(a.performanceBand.key, (counts.get(a.performanceBand.key) ?? 0) + 1);
        bandCounts.set(signature, counts);
        classified += 1;
        continue;
      }
      if (a.performanceLevel) {
        levelCounts.set(a.performanceLevel, (levelCounts.get(a.performanceLevel) ?? 0) + 1);
        classified += 1;
      }
    }

    if (classified === 0) return { kind: 'empty' };

    const scaleCount = signatureBands.size + (levelCounts.size > 0 ? 1 : 0);
    if (scaleCount > 1) return { kind: 'mixed', scaleCount };

    if (signatureBands.size === 1) {
      const entry = [...signatureBands.entries()][0]!;
      const counts = bandCounts.get(entry[0])!;
      const vocabulary =
        entry[1].length > 0
          ? bandsToViews(entry[1])
          : this.vocabularyFromResults(byAssessment, counts);
      const buckets = vocabulary
        .map((b) => {
          const count = counts.get(b.key) ?? 0;
          return {
            key: b.key,
            label: b.label,
            order: b.order,
            color: b.color ?? null,
            count,
            percentage: (count / classified) * 100,
          };
        })
        .sort((a, b) => a.order - b.order);
      return { kind: 'band', bands: vocabulary, buckets };
    }

    const buckets: PerformanceDistributionBucket[] = PERFORMANCE_LEVELS.map((level) => {
      const count = levelCounts.get(level) ?? 0;
      return { level, count, percentage: (count / classified) * 100 };
    });
    return { kind: 'level', buckets };
  }

  private vocabularyFromResults(
    byAssessment: StudentPanoramaAssessment[],
    counts: Map<string, number>,
  ): PerformanceBandView[] {
    const views = new Map<string, PerformanceBandView>();
    for (const a of byAssessment) {
      if (a.performanceBand && counts.has(a.performanceBand.key)) {
        views.set(a.performanceBand.key, a.performanceBand);
      }
    }
    return [...views.values()].sort((a, b) => a.order - b.order);
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
