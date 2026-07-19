import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import {
  assessmentCourseAssignments,
  assessmentResults,
  assessmentSkillStats,
  classGroups,
  grades,
  skillResults,
  studentEnrollments,
  students,
  taxonomyNodes,
  withOrgContext,
} from '@soe/db';
import {
  REQUIRES_SUPPORT_LEVEL,
  OFFICIAL_REPORT_LEVEL_ORDER,
  RESULT_HIDDEN_NODE_TYPES,
  percentageToPerformanceLevel,
  type OfficialAlternativeDistribution,
  type OfficialCourseGeneralResult,
  type OfficialCourseReportQueryDto,
  type OfficialCourseReportResponse,
  type OfficialCourseSkillAxis,
  type OfficialCourseStudentRow,
  type OfficialDevelopmentDistribution,
  type OfficialSpecTableRow,
  type PerformanceBandInput,
  type PerformanceDistributionBucket,
  type PerformanceLevel,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { loadInstrumentBands } from '../performance-bands/lib/load-instrument-bands';
import {
  loadCohortLevelCounts,
  levelCountsToLegacyDistribution,
  type CohortLevelCount,
} from '../common/helpers/cohort-level-stats.helper';
import {
  COHORT_PCT_SUM,
  COHORT_PCT_WEIGHT,
  COHORT_STUDENTS_ASSESSED,
  addCohortRow,
  cohortAverage,
  type CohortAccumulator,
} from '../common/helpers/cohort-skill-stats.helper';
import {
  loadCohortOverallAchievement,
  type CohortOverallAchievement,
} from '../common/helpers/cohort-item-stats.helper';
import { ReportSupportService, type ReportScope } from './report-support.service';
import {
  loadDevelopmentDistributions,
  loadItemColumns,
  loadItemDistributions,
  type ItemReportColumn,
} from './lib/item-report-data';

type EvaluatedStudent = {
  studentId: string;
  studentRut: string;
  firstName: string;
  lastName: string;
  percentage: number | null;
  grade: number | null;
  performanceLevel: PerformanceLevel | null;
};

@Injectable()
export class CourseReportService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly support: ReportSupportService,
  ) {}

  async getCourseReport(
    user: JwtPayload,
    query: OfficialCourseReportQueryDto,
  ): Promise<OfficialCourseReportResponse> {
    const orgId = this.support.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const assessment = await this.support.requireAssessment(tx, user, orgId, query.assessmentId);
      const scope = await this.support.getAccessibleClassGroupIds(tx, user, orgId);

      if (!scope.scopeAll) {
        const hasScope = await this.support.assessmentTouchesScope(
          tx,
          query.assessmentId,
          scope.classGroupIds,
        );
        if (!hasScope) {
          throw new ForbiddenException('No tiene acceso a los resultados de esta evaluación');
        }
      }
      if (query.classGroupId) {
        const ok = await this.support.classGroupInScope(tx, orgId, scope, query.classGroupId);
        if (!ok) throw new ForbiddenException('No tiene acceso a ese curso');
      }

      const studentFilter = await this.support.resolveAccessibleStudentIds(
        tx,
        orgId,
        scope,
        query.classGroupId,
      );
      // El mismo scope resuelto a cursos, para la tabla de especificaciones (que lee
      // el read-model de cohorte, de grano por curso). Ver resolveAccessibleClassGroupIds.
      const classGroupFilter = this.support.resolveAccessibleClassGroupIds(
        scope,
        query.classGroupId,
      );

      const reportClassGroups = await this.loadAssessmentClassGroups(
        tx,
        query.assessmentId,
        orgId,
        scope,
        query.classGroupId,
      );
      const focusClassGroup =
        query.classGroupId != null
          ? (reportClassGroups.find((c) => c.id === query.classGroupId) ?? null)
          : (reportClassGroups[0] ?? null);

      const [orgMeta, directorName] = await Promise.all([
        this.support.loadOrgMeta(tx, orgId),
        this.support.loadDirectorName(tx, orgId),
      ]);
      const teacherName = await this.support.loadTeacherName(
        tx,
        focusClassGroup?.id ?? null,
        assessment.subjectId,
      );

      const itemColumns = await loadItemColumns(tx, assessment.instrumentId);
      const itemIds = itemColumns.map((c) => c.itemId);

      const evaluated = await this.loadEvaluatedStudents(
        tx,
        query.assessmentId,
        orgId,
        studentFilter,
      );
      const classGroupByStudent = await this.loadStudentClassGroups(
        tx,
        query.assessmentId,
        evaluated.map((s) => s.studentId),
      );

      // Informe oficial cargado en modo agregado: sin filas por alumno. El logro del
      // curso (§2) sale del read-model de ítems y los ejes de habilidad (§3) del
      // read-model por eje, ambos ya persistidos por el importador. La distribución
      // por nivel y "requiere apoyo" dependen del dato por alumno / de la Figura 1 y
      // quedan fuera de esta capa (se ven vacíos hasta cargar los niveles).
      const isAggregate = assessment.dataGranularity === 'aggregate_only';
      const aggregate = isAggregate
        ? await loadCohortOverallAchievement(tx, query.assessmentId, classGroupFilter)
        : null;
      const studentsConsidered = aggregate ? aggregate.studentsAssessed : evaluated.length;

      // Distribución por nivel del informe agregado (§2 torta + "requiere apoyo"):
      // desde `assessment_level_stats`. Sin filas → se deja vacío como antes. Las
      // bandas del instrumento aportan el mapeo banda→nivel legacy y cuál es la banda
      // de menor logro ("requiere mayor apoyo").
      const levelData: { counts: CohortLevelCount[]; bands: PerformanceBandInput[] } | null =
        isAggregate
          ? {
              counts: await loadCohortLevelCounts(tx, query.assessmentId, classGroupFilter),
              bands: await loadInstrumentBands(tx, assessment.instrumentId),
            }
          : null;

      const variant = this.support.resolveVariant(assessment.period);
      const disclaimers = this.support.resolveDisclaimers(assessment.instrumentConfig);
      const reflectionPrompts = this.support.resolveReflectionPrompts(assessment.instrumentConfig);

      const meta: OfficialCourseReportResponse['meta'] = {
        orgId: orgMeta.orgId,
        orgName: orgMeta.orgName,
        rbd: orgMeta.rbd,
        commune: orgMeta.commune,
        region: orgMeta.region,
        directorName,
        instrumentId: assessment.instrumentId,
        instrumentName: assessment.instrumentName,
        instrumentType: assessment.instrumentType,
        subjectId: assessment.subjectId,
        subjectName: assessment.subjectName,
        period: assessment.period,
        periodLabel: assessment.periodLabel,
        year: assessment.instrumentYear,
        generatedAt: new Date().toISOString(),
        disclaimers,
        variant,
        classGroup: focusClassGroup
          ? {
              id: focusClassGroup.id,
              name: focusClassGroup.name,
              gradeName: focusClassGroup.gradeName,
            }
          : null,
        teacherName,
        administeredAt: assessment.administeredAt,
        studentsConsidered,
        dataGranularity: assessment.dataGranularity,
      };

      const generalResult = this.buildGeneralResult(evaluated, aggregate, levelData);
      const skillAxes = isAggregate
        ? await this.buildSkillAxesFromCohort(
            tx,
            query.assessmentId,
            classGroupFilter,
            assessment.gradingScaleConfig,
          )
        : await this.buildSkillAxes(
            tx,
            query.assessmentId,
            orgId,
            studentFilter,
            assessment.gradingScaleConfig,
          );
      const specTable = await this.buildSpecTable(
        tx,
        query.assessmentId,
        itemColumns,
        itemIds,
        classGroupFilter,
      );
      const studentResults = this.buildStudentResults(evaluated, classGroupByStudent);

      return {
        meta,
        generalResult,
        skillAxes,
        specTable,
        studentResults,
        reflectionPrompts,
      };
    });
  }

  // ── Sección 2 ────────────────────────────────────────────────────────────

  private buildGeneralResult(
    evaluated: EvaluatedStudent[],
    aggregate: CohortOverallAchievement | null,
    levelData: { counts: CohortLevelCount[]; bands: PerformanceBandInput[] } | null,
  ): OfficialCourseGeneralResult {
    // Modo agregado: el logro del curso y el N vienen del read-model de ítems; la
    // distribución por nivel y "requiere apoyo" del read-model por nivel
    // (`assessment_level_stats`, Gráfico 1). Sin filas de nivel quedan vacíos, como
    // antes de cargar los niveles.
    if (aggregate) {
      const averageAchievement = aggregate.averageAchievement;
      const performanceLevel =
        averageAchievement === null ? null : percentageToPerformanceLevel(averageAchievement / 100);

      if (levelData && levelData.counts.length > 0) {
        const { counts, bands } = levelData;
        const total = counts.reduce((acc, c) => acc + c.count, 0);
        // "Requiere mayor apoyo" = alumnos en la banda de MENOR order (menor logro).
        const lowestBand = [...bands].sort((a, b) => a.order - b.order)[0];
        const requiresSupportCount = lowestBand
          ? (counts.find((c) => c.performanceBandId === lowestBand.id)?.count ?? 0)
          : 0;
        return {
          studentsConsidered: aggregate.studentsAssessed,
          averageAchievement,
          performanceLevel,
          requiresSupportCount,
          requiresSupportPercentage: total > 0 ? (requiresSupportCount / total) * 100 : null,
          distribution: levelCountsToLegacyDistribution(counts, bands),
        };
      }

      return {
        studentsConsidered: aggregate.studentsAssessed,
        averageAchievement,
        performanceLevel,
        requiresSupportCount: 0,
        requiresSupportPercentage: null,
        distribution: buildDistribution([]),
      };
    }

    const pcts = evaluated.map((e) => e.percentage).filter((p): p is number => p !== null);
    const averageAchievement = pcts.length > 0 ? avg(pcts) : null;
    const requiresSupportCount = evaluated.filter(
      (e) => e.performanceLevel === REQUIRES_SUPPORT_LEVEL,
    ).length;
    return {
      studentsConsidered: evaluated.length,
      averageAchievement,
      performanceLevel:
        averageAchievement === null ? null : percentageToPerformanceLevel(averageAchievement / 100),
      requiresSupportCount,
      requiresSupportPercentage:
        evaluated.length > 0 ? (requiresSupportCount / evaluated.length) * 100 : null,
      distribution: buildDistribution(evaluated.map((e) => e.performanceLevel)),
    };
  }

  // ── Sección 3 ────────────────────────────────────────────────────────────

  private async buildSkillAxes(
    tx: Database,
    assessmentId: string,
    orgId: string,
    studentFilter: string[] | null,
    scaleConfig: unknown,
  ): Promise<OfficialCourseSkillAxis[]> {
    if (studentFilter !== null && studentFilter.length === 0) return [];

    const conditions = [
      eq(skillResults.assessmentId, assessmentId),
      eq(students.orgId, orgId),
      isNull(students.deletedAt),
    ];
    if (studentFilter !== null) {
      conditions.push(inArray(skillResults.studentId, studentFilter));
    }

    const rows = await tx
      .select({
        nodeId: taxonomyNodes.id,
        nodeName: taxonomyNodes.name,
        nodeType: sql<string>`${taxonomyNodes.type}::text`,
        nodeCode: taxonomyNodes.code,
        avgPct: sql<string | null>`avg(${skillResults.percentage}::numeric)`,
        studentsAssessed: sql<number>`count(distinct ${skillResults.studentId})::int`,
      })
      .from(skillResults)
      .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, skillResults.nodeId))
      .innerJoin(students, eq(students.id, skillResults.studentId))
      .where(and(...conditions))
      .groupBy(taxonomyNodes.id, taxonomyNodes.name, taxonomyNodes.type, taxonomyNodes.code);

    const axes: OfficialCourseSkillAxis[] = rows.map((r) => {
      const averageAchievement = r.avgPct === null ? null : Number(r.avgPct);
      return {
        nodeId: r.nodeId,
        nodeName: r.nodeName,
        nodeType: r.nodeType,
        nodeCode: r.nodeCode ?? null,
        studentsAssessed: Number(r.studentsAssessed),
        averageAchievement,
        performanceLevel:
          averageAchievement === null
            ? null
            : percentageToPerformanceLevel(averageAchievement / 100, {
                config: scaleConfig as never,
              }),
      };
    });

    // Brechas primero (menor logro). Sin datos al final.
    return axes.sort((a, b) => (a.averageAchievement ?? 101) - (b.averageAchievement ?? 101));
  }

  /**
   * Ejes de habilidad para un informe cargado en modo agregado: lee el read-model de
   * cohorte (`assessment_skill_stats`) en vez de `skill_results`, que no existe sin
   * dato por alumno. Misma aritmética ponderada por `studentCount` que
   * `AssessmentReportService.buildSkills` (helper `cohort-skill-stats`), de modo que
   * el eje del informe oficial y el del heatmap no discrepan.
   */
  private async buildSkillAxesFromCohort(
    tx: Database,
    assessmentId: string,
    classGroupFilter: string[] | null,
    scaleConfig: unknown,
  ): Promise<OfficialCourseSkillAxis[]> {
    if (classGroupFilter !== null && classGroupFilter.length === 0) return [];

    const conditions = [
      eq(assessmentSkillStats.assessmentId, assessmentId),
      // Los descriptores no se reportan como eje/habilidad (igual que buildSkills).
      notInArray(taxonomyNodes.type, [...RESULT_HIDDEN_NODE_TYPES]),
    ];
    if (classGroupFilter !== null) {
      conditions.push(inArray(assessmentSkillStats.classGroupId, classGroupFilter));
    }

    const rows = await tx
      .select({
        nodeId: assessmentSkillStats.nodeId,
        nodeName: taxonomyNodes.name,
        nodeType: sql<string>`${taxonomyNodes.type}::text`,
        nodeCode: taxonomyNodes.code,
        pctSum: COHORT_PCT_SUM,
        pctWeight: COHORT_PCT_WEIGHT,
        studentsAssessed: COHORT_STUDENTS_ASSESSED,
      })
      .from(assessmentSkillStats)
      .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, assessmentSkillStats.nodeId))
      .where(and(...conditions))
      // El curso NO puede faltar del group by: hace correcto el `max` de
      // COHORT_STUDENTS_ASSESSED, que después `addCohortRow` suma entre cursos.
      .groupBy(
        assessmentSkillStats.nodeId,
        taxonomyNodes.name,
        taxonomyNodes.type,
        taxonomyNodes.code,
        assessmentSkillStats.classGroupId,
      );

    const acc = new Map<string, CohortAccumulator>();
    const meta = new Map<string, { nodeName: string; nodeType: string; nodeCode: string | null }>();
    for (const r of rows) {
      addCohortRow(acc, r.nodeId, r);
      if (!meta.has(r.nodeId)) {
        meta.set(r.nodeId, {
          nodeName: r.nodeName,
          nodeType: r.nodeType,
          nodeCode: r.nodeCode ?? null,
        });
      }
    }

    const axes: OfficialCourseSkillAxis[] = [...acc.entries()].map(([nodeId, a]) => {
      const averageAchievement = cohortAverage(a);
      const m = meta.get(nodeId)!;
      return {
        nodeId,
        nodeName: m.nodeName,
        nodeType: m.nodeType,
        nodeCode: m.nodeCode,
        studentsAssessed: a.studentsAssessed,
        averageAchievement,
        performanceLevel:
          averageAchievement === null
            ? null
            : percentageToPerformanceLevel(averageAchievement / 100, {
                config: scaleConfig as never,
              }),
      };
    });

    // Brechas primero (menor logro). Sin datos al final.
    return axes.sort((a, b) => (a.averageAchievement ?? 101) - (b.averageAchievement ?? 101));
  }

  // ── Sección 4 ────────────────────────────────────────────────────────────

  /** Toda la tabla es agregable: ambas distribuciones salen del read-model de cohorte. */
  private async buildSpecTable(
    tx: Database,
    assessmentId: string,
    itemColumns: ItemReportColumn[],
    itemIds: string[],
    classGroupFilter: string[] | null,
  ): Promise<OfficialSpecTableRow[]> {
    if (itemColumns.length === 0) return [];

    const dist = await loadItemDistributions(tx, assessmentId, itemIds, classGroupFilter);
    const devItemIds = itemColumns.filter((c) => !c.hasAlternatives).map((c) => c.itemId);
    const devDist = await loadDevelopmentDistributions(
      tx,
      assessmentId,
      devItemIds,
      classGroupFilter,
    );

    return itemColumns.map((col) => {
      const d = dist.get(col.itemId);
      const totalResponses = d?.totalResponses ?? 0;
      const answeredCount = d?.answeredCount ?? 0;
      const blankCount = totalResponses - answeredCount;
      const correctCount = d?.correctCount ?? 0;
      const difficulty = totalResponses > 0 ? (correctCount / totalResponses) * 100 : null;
      const correctRate = difficulty;

      let alternatives: OfficialAlternativeDistribution[] = [];
      let developmentDistribution: OfficialDevelopmentDistribution[] | null = null;

      if (col.hasAlternatives) {
        alternatives = col.alternatives.map((alt) => {
          const count = d?.byAnswer.get(alt.key) ?? 0;
          return {
            key: alt.key,
            text: alt.text,
            isCorrect: col.correctKey != null ? alt.key === col.correctKey : alt.isCorrect,
            count,
            percentage: totalResponses > 0 ? (count / totalResponses) * 100 : 0,
          };
        });
      } else {
        const dev = devDist.get(col.itemId) ?? { rc: 0, rpc: 0, ri: 0, n: 0 };
        const devTotal = dev.rc + dev.rpc + dev.ri + dev.n;
        developmentDistribution = [
          { category: 'RC', count: dev.rc },
          { category: 'RPC', count: dev.rpc },
          { category: 'RI', count: dev.ri },
          { category: 'N', count: dev.n },
        ].map((b) => ({
          category: b.category as OfficialDevelopmentDistribution['category'],
          count: b.count,
          percentage: devTotal > 0 ? (b.count / devTotal) * 100 : 0,
        }));
      }

      return {
        itemId: col.itemId,
        position: col.position,
        itemType: col.itemType,
        oaCode: col.oaCode,
        oaName: col.oaName,
        textType: col.textType,
        axis: col.axis,
        skill: col.skill,
        indicator: col.indicator,
        correctKey: col.correctKey,
        totalResponses,
        blankCount,
        correctCount,
        correctRate,
        difficulty,
        alternatives,
        developmentDistribution,
      };
    });
  }

  // ── Sección 5 ────────────────────────────────────────────────────────────

  private buildStudentResults(
    evaluated: EvaluatedStudent[],
    classGroupByStudent: Map<string, { id: string; name: string }>,
  ): OfficialCourseStudentRow[] {
    return [...evaluated]
      .sort((a, b) =>
        `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'es'),
      )
      .map((e) => {
        const cg = classGroupByStudent.get(e.studentId);
        return {
          studentId: e.studentId,
          studentRut: e.studentRut,
          studentFullName: `${e.firstName} ${e.lastName}`.trim(),
          classGroupId: cg?.id ?? null,
          classGroupName: cg?.name ?? null,
          achievement: e.percentage,
          grade: e.grade,
          performanceLevel: e.performanceLevel,
          requiresSupport: e.performanceLevel === REQUIRES_SUPPORT_LEVEL,
        };
      });
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  private async loadEvaluatedStudents(
    tx: Database,
    assessmentId: string,
    orgId: string,
    studentFilter: string[] | null,
  ): Promise<EvaluatedStudent[]> {
    if (studentFilter !== null && studentFilter.length === 0) return [];

    const conditions = [
      eq(assessmentResults.assessmentId, assessmentId),
      eq(students.orgId, orgId),
      isNull(students.deletedAt),
    ];
    if (studentFilter !== null) {
      conditions.push(inArray(assessmentResults.studentId, studentFilter));
    }

    const rows = await tx
      .select({
        studentId: assessmentResults.studentId,
        studentRut: students.rut,
        firstName: students.firstName,
        lastName: students.lastName,
        percentage: assessmentResults.percentage,
        grade: assessmentResults.grade,
        performanceLevel: assessmentResults.performanceLevel,
      })
      .from(assessmentResults)
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .where(and(...conditions));

    return rows.map((r) => ({
      studentId: r.studentId,
      studentRut: r.studentRut,
      firstName: r.firstName,
      lastName: r.lastName,
      percentage: r.percentage === null ? null : Number(r.percentage),
      grade: r.grade === null ? null : Number(r.grade),
      performanceLevel: r.performanceLevel,
    }));
  }

  private async loadStudentClassGroups(
    tx: Database,
    assessmentId: string,
    studentIds: string[],
  ): Promise<Map<string, { id: string; name: string }>> {
    const result = new Map<string, { id: string; name: string }>();
    if (studentIds.length === 0) return result;

    const rows = await tx
      .select({
        studentId: studentEnrollments.studentId,
        classGroupId: classGroups.id,
        classGroupName: classGroups.name,
      })
      .from(studentEnrollments)
      .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
      .innerJoin(
        assessmentCourseAssignments,
        and(
          eq(assessmentCourseAssignments.classGroupId, classGroups.id),
          eq(assessmentCourseAssignments.assessmentId, assessmentId),
        ),
      )
      .where(inArray(studentEnrollments.studentId, studentIds))
      .orderBy(asc(studentEnrollments.studentId), asc(classGroups.name));

    for (const row of rows) {
      if (!result.has(row.studentId)) {
        result.set(row.studentId, { id: row.classGroupId, name: row.classGroupName });
      }
    }
    return result;
  }

  private async loadAssessmentClassGroups(
    tx: Database,
    assessmentId: string,
    orgId: string,
    scope: ReportScope,
    classGroupId: string | undefined,
  ): Promise<{ id: string; name: string; gradeName: string | null }[]> {
    const conditions = [
      eq(assessmentCourseAssignments.assessmentId, assessmentId),
      eq(classGroups.orgId, orgId),
    ];
    if (classGroupId) {
      conditions.push(eq(classGroups.id, classGroupId));
    } else if (!scope.scopeAll) {
      if (scope.classGroupIds.length === 0) return [];
      conditions.push(inArray(classGroups.id, scope.classGroupIds));
    }

    const rows = await tx
      .select({
        id: classGroups.id,
        name: classGroups.name,
        gradeName: grades.name,
      })
      .from(assessmentCourseAssignments)
      .innerJoin(classGroups, eq(classGroups.id, assessmentCourseAssignments.classGroupId))
      .leftJoin(grades, eq(grades.id, classGroups.gradeId))
      .where(and(...conditions))
      .orderBy(asc(classGroups.name));

    return rows.map((r) => ({ id: r.id, name: r.name, gradeName: r.gradeName ?? null }));
  }
}

// ── util ─────────────────────────────────────────────────────────────────────

function avg(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function buildDistribution(levels: (PerformanceLevel | null)[]): PerformanceDistributionBucket[] {
  const counts = new Map<PerformanceLevel, number>();
  for (const level of levels) {
    if (!level) continue;
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  return OFFICIAL_REPORT_LEVEL_ORDER.map((level) => {
    const count = counts.get(level) ?? 0;
    return { level, count, percentage: total > 0 ? (count / total) * 100 : 0 };
  });
}
