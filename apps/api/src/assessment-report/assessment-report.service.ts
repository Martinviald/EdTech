import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  assessmentCourseAssignments,
  assessmentResults,
  assessments,
  classGroups,
  gradingScales,
  grades,
  instruments,
  itemTaxonomyTags,
  items,
  responses,
  skillResults,
  studentEnrollments,
  students,
  subjectClasses,
  subjects,
  taxonomyNodes,
  teacherAssignments,
  withOrgContext,
} from '@soe/db';
import {
  RESULTS_VIEWER_ROLES,
  percentageToPerformanceLevel,
  userHasAnyRole,
  type AssessmentReportCourseRow,
  type AssessmentReportItemRow,
  type AssessmentReportQueryDto,
  type AssessmentReportRecommendation,
  type AssessmentReportResponse,
  type AssessmentReportRiskStudent,
  type AssessmentReportSkillRow,
  type ItemReportFlag,
  type PerformanceDistributionBucket,
  type PerformanceLevel,
  type UserRole,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';

// Roles administrativos: ven toda la org. Idéntico a los demás services de
// resultados (AssessmentResultsService / AnalyticsService / ItemAnalysisService).
const ADMIN_LIKE_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
];

const CONTENT_NODE_TYPES: readonly string[] = ['content', 'learning_objective'];

const PERFORMANCE_LEVELS_ORDER: readonly PerformanceLevel[] = [
  'insufficient',
  'elementary',
  'adequate',
  'advanced',
];

// Niveles que cuentan como "en riesgo" para el foco de intervención.
const AT_RISK_LEVELS: readonly PerformanceLevel[] = ['insufficient', 'elementary'];

const DEFAULT_PASSING_GRADE = 4.0;

// Umbrales de los flags psicométricos. No hardcodean instrumento: son convención
// psicométrica estándar aplicable a cualquier prueba de selección múltiple.
const DIFFICULTY_CRITICAL = 40; // p < 40% → contenido no logrado
const DIFFICULTY_EASY = 85; // p >= 85% → ítem muy fácil
const DISCRIMINATION_LOW = 0.2; // D < 0.2 → pregunta poco discriminativa
const DISCRIMINATION_GROUP_FRACTION = 0.27; // grupos alto/bajo (Kelley)

type ScopeResult = { scopeAll: boolean; classGroupIds: string[] };

interface ItemAlternative {
  key?: unknown;
  isCorrect?: unknown;
}
interface ItemContent {
  alternatives?: unknown;
  correctKey?: unknown;
}

@Injectable()
export class AssessmentReportService {
  constructor(@InjectDb() private readonly db: Database) {}

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/analytics/assessment-report  (H6.13)
  // Informe consolidado de una evaluación para directivos / UTP.
  // ───────────────────────────────────────────────────────────────────────────

  async getReport(
    user: JwtPayload,
    query: AssessmentReportQueryDto,
  ): Promise<AssessmentReportResponse> {
    const orgId = this.requireOrgId(user);

    // Todo el informe consulta tablas con RLS (assessments, assessment_results,
    // responses, skill_results, students). Debe correr dentro de withOrgContext
    // para fijar `app.current_org_id` en la transacción; de lo contrario, bajo un
    // rol sin BYPASSRLS (soe_app en cloud) el RLS devuelve 0 filas → 404 (§5.2).
    // Los helpers de acceso a datos reciben el `tx` de la transacción, nunca
    // this.db (una query en this.db correría sin contexto).
    return withOrgContext(this.db, orgId, async (tx) => {
      const assessment = await this.requireAssessment(tx, user, orgId, query.assessmentId);
      const scope = await this.getAccessibleClassGroupIds(tx, user, orgId);

      // Profesor sin scope sobre esta evaluación → 403.
      if (!scope.scopeAll) {
        const hasScope = await this.assessmentTouchesScope(
          tx,
          query.assessmentId,
          scope.classGroupIds,
        );
        if (!hasScope) {
          throw new ForbiddenException(
            'No tiene acceso a los resultados de esta evaluación',
          );
        }
      }
      if (query.classGroupId) {
        const ok = await this.classGroupInScope(tx, orgId, scope, query.classGroupId);
        if (!ok) throw new ForbiddenException('No tiene acceso a ese curso');
      }

      const studentFilter = await this.resolveAccessibleStudentIds(
        tx,
        orgId,
        scope,
        query.classGroupId,
      );

      const passingGrade = await this.resolvePassingGrade(tx, assessment.gradingScaleId);

      // Cursos de la evaluación visibles para el caller (intersectados con el scope).
      const reportClassGroups = await this.loadAssessmentClassGroups(
        tx,
        query.assessmentId,
        orgId,
        scope,
        query.classGroupId,
      );
      const gradeName = reportClassGroups.find((c) => c.gradeName)?.gradeName ?? null;

      // Ítems del instrumento + sus tags (skill/content) representativos.
      const itemColumns = await this.loadItemColumns(tx, assessment.instrumentId);
      const itemIds = itemColumns.map((i) => i.itemId);

      // Alumnos evaluados (con assessment_results) dentro del scope.
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
      const studentsEnrolled = await this.countEnrolled(
        tx,
        reportClassGroups.map((c) => c.id),
      );

      const meta = {
        assessmentId: assessment.id,
        assessmentName: assessment.name,
        instrumentName: assessment.instrumentName,
        instrumentType: assessment.instrumentType,
        subjectName: assessment.subjectName,
        gradeName,
        administeredAt: assessment.administeredAt,
        classGroups: reportClassGroups.map((c) => ({ id: c.id, name: c.name })),
        itemsCount: itemColumns.length,
      };

      // Caso sin alumnos evaluados: informe vacío pero bien formado.
      if (evaluated.length === 0) {
        return {
          meta,
          summary: {
            studentsEvaluated: 0,
            studentsEnrolled,
            coverageRate: studentsEnrolled > 0 ? 0 : null,
            averageAchievement: null,
            averageGrade: null,
            passingGrade,
            passingRate: null,
            performanceLevel: null,
          },
          distribution: this.emptyDistribution(),
          courseComparison: [],
          skills: [],
          highlights: { strengths: [], gaps: [] },
          items: itemColumns.map((c) => this.emptyItemRow(c)),
          studentsAtRisk: [],
          recommendations: [],
        };
      }

      // ── Síntesis ejecutiva ──────────────────────────────────────────────────
      const summary = this.buildSummary(
        evaluated,
        studentsEnrolled,
        passingGrade,
        assessment.gradingScaleConfig,
      );
      const distribution = this.buildDistribution(evaluated);

      // ── Comparativa por curso ───────────────────────────────────────────────
      const courseComparison = this.buildCourseComparison(
        evaluated,
        classGroupByStudent,
        passingGrade,
        summary.averageAchievement,
      );

      // ── Análisis psicométrico de ítems ──────────────────────────────────────
      const items = await this.buildItemAnalysis(
        tx,
        query.assessmentId,
        itemColumns,
        itemIds,
        evaluated,
        studentFilter,
      );

      // ── Fortalezas y brechas por habilidad ──────────────────────────────────
      const skills = await this.buildSkills(
        tx,
        query.assessmentId,
        orgId,
        studentFilter,
        assessment.gradingScaleConfig,
      );
      const highlights = this.buildHighlights(skills);

      // ── Alumnos en foco ─────────────────────────────────────────────────────
      const studentsAtRisk = await this.buildRiskStudents(
        tx,
        query.assessmentId,
        evaluated,
        classGroupByStudent,
      );

      // ── Recomendaciones (reglas) ────────────────────────────────────────────
      const recommendations = this.buildRecommendations(
        summary,
        skills,
        items,
        studentsAtRisk,
      );

      return {
        meta,
        summary,
        distribution,
        courseComparison,
        skills,
        highlights,
        items,
        studentsAtRisk,
        recommendations,
      };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Síntesis ejecutiva / distribución
  // ───────────────────────────────────────────────────────────────────────────

  private buildSummary(
    evaluated: EvaluatedStudent[],
    studentsEnrolled: number,
    passingGrade: number,
    scaleConfig: unknown,
  ) {
    const pcts = evaluated
      .map((e) => e.percentage)
      .filter((p): p is number => p !== null);
    const grades = evaluated.map((e) => e.grade).filter((g): g is number => g !== null);

    const averageAchievement = pcts.length > 0 ? avg(pcts) : null;
    const averageGrade = grades.length > 0 ? avg(grades) : null;
    const passingRate =
      grades.length > 0
        ? (grades.filter((g) => g >= passingGrade).length / grades.length) * 100
        : null;
    const coverageRate =
      studentsEnrolled > 0 ? (evaluated.length / studentsEnrolled) * 100 : null;

    return {
      studentsEvaluated: evaluated.length,
      studentsEnrolled,
      coverageRate,
      averageAchievement,
      averageGrade,
      passingGrade,
      passingRate,
      performanceLevel:
        averageAchievement === null
          ? null
          : percentageToPerformanceLevel(averageAchievement / 100, {
              config: scaleConfig as never,
            }),
    };
  }

  private buildDistribution(
    evaluated: EvaluatedStudent[],
  ): PerformanceDistributionBucket[] {
    const counts = new Map<PerformanceLevel, number>();
    for (const e of evaluated) {
      if (!e.performanceLevel) continue;
      counts.set(e.performanceLevel, (counts.get(e.performanceLevel) ?? 0) + 1);
    }
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    return PERFORMANCE_LEVELS_ORDER.map((level) => {
      const count = counts.get(level) ?? 0;
      return { level, count, percentage: total > 0 ? (count / total) * 100 : 0 };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Comparativa por curso (intra-evaluación)
  // ───────────────────────────────────────────────────────────────────────────

  private buildCourseComparison(
    evaluated: EvaluatedStudent[],
    classGroupByStudent: Map<string, { id: string; name: string }>,
    passingGrade: number,
    overallAchievement: number | null,
  ): AssessmentReportCourseRow[] {
    const byCourse = new Map<
      string,
      { name: string; pcts: number[]; grades: number[]; critical: number }
    >();
    for (const e of evaluated) {
      const cg = classGroupByStudent.get(e.studentId);
      if (!cg) continue;
      let entry = byCourse.get(cg.id);
      if (!entry) {
        entry = { name: cg.name, pcts: [], grades: [], critical: 0 };
        byCourse.set(cg.id, entry);
      }
      if (e.percentage !== null) entry.pcts.push(e.percentage);
      if (e.grade !== null) entry.grades.push(e.grade);
      if (e.performanceLevel && AT_RISK_LEVELS.includes(e.performanceLevel)) {
        entry.critical += 1;
      }
    }

    const rows: AssessmentReportCourseRow[] = [];
    for (const [classGroupId, entry] of byCourse) {
      const averageAchievement = entry.pcts.length > 0 ? avg(entry.pcts) : null;
      const passingRate =
        entry.grades.length > 0
          ? (entry.grades.filter((g) => g >= passingGrade).length /
              entry.grades.length) *
            100
          : null;
      rows.push({
        classGroupId,
        classGroupName: entry.name,
        studentsEvaluated: entry.pcts.length,
        averageAchievement,
        passingRate,
        criticalStudents: entry.critical,
        gapVsAverage:
          averageAchievement !== null && overallAchievement !== null
            ? averageAchievement - overallAchievement
            : null,
      });
    }

    // Mejor logro primero (los cursos al fondo de la lista son los que necesitan apoyo).
    return rows.sort(
      (a, b) => (b.averageAchievement ?? -1) - (a.averageAchievement ?? -1),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Análisis psicométrico de ítems
  // ───────────────────────────────────────────────────────────────────────────

  private async buildItemAnalysis(
    db: Database,
    assessmentId: string,
    itemColumns: ItemColumn[],
    itemIds: string[],
    evaluated: EvaluatedStudent[],
    studentFilter: string[] | null,
  ): Promise<AssessmentReportItemRow[]> {
    if (itemIds.length === 0) return [];

    // Distribución de respuestas por ítem y alternativa (1 query) → dificultad +
    // distractor dominante.
    const dist = await this.loadItemDistribution(db, assessmentId, itemIds, studentFilter);

    // Discriminación: grupos alto/bajo (27%) por puntaje total. Sólo se calcula si
    // hay alumnos suficientes en cada grupo.
    const sorted = [...evaluated]
      .filter((e) => e.percentage !== null)
      .sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0));
    const groupSize = Math.floor(sorted.length * DISCRIMINATION_GROUP_FRACTION);
    let topCorrect = new Map<string, { correct: number; total: number }>();
    let bottomCorrect = new Map<string, { correct: number; total: number }>();
    if (groupSize >= 1) {
      const topIds = sorted.slice(0, groupSize).map((e) => e.studentId);
      const bottomIds = sorted.slice(-groupSize).map((e) => e.studentId);
      [topCorrect, bottomCorrect] = await Promise.all([
        this.loadGroupCorrectness(db, assessmentId, itemIds, topIds),
        this.loadGroupCorrectness(db, assessmentId, itemIds, bottomIds),
      ]);
    }

    return itemColumns.map((col) => {
      const d = dist.get(col.itemId);
      const totalResponses = d?.totalResponses ?? 0;
      const answeredCount = d?.answeredCount ?? 0;
      const blankCount = totalResponses - answeredCount;
      const correctCount = d?.correctCount ?? 0;
      const difficulty =
        totalResponses > 0 ? (correctCount / totalResponses) * 100 : null;

      const top = topCorrect.get(col.itemId);
      const bottom = bottomCorrect.get(col.itemId);
      let discrimination: number | null = null;
      if (top && bottom && top.total > 0 && bottom.total > 0) {
        discrimination = top.correct / top.total - bottom.correct / bottom.total;
      }

      const topDistractorKey = d?.topDistractorKey ?? null;
      const topDistractorCount = d?.topDistractorCount ?? 0;
      const topDistractorRate =
        totalResponses > 0 && topDistractorKey
          ? (topDistractorCount / totalResponses) * 100
          : null;

      const flags = this.deriveItemFlags({
        difficulty,
        discrimination,
        correctCount,
        topDistractorCount,
      });

      return {
        itemId: col.itemId,
        position: col.position,
        skillName: col.skillName,
        contentName: col.contentName,
        correctKey: col.correctKey,
        answeredCount,
        blankCount,
        totalResponses,
        difficulty,
        discrimination,
        topDistractorKey,
        topDistractorRate,
        flags,
      };
    });
  }

  private deriveItemFlags(input: {
    difficulty: number | null;
    discrimination: number | null;
    correctCount: number;
    topDistractorCount: number;
  }): ItemReportFlag[] {
    const flags: ItemReportFlag[] = [];
    if (input.difficulty !== null && input.difficulty < DIFFICULTY_CRITICAL) {
      flags.push('critical');
    }
    if (input.difficulty !== null && input.difficulty >= DIFFICULTY_EASY) {
      flags.push('easy');
    }
    if (
      input.discrimination !== null &&
      input.discrimination < DISCRIMINATION_LOW
    ) {
      flags.push('low_discrimination');
    }
    // Distractor potente: una alternativa incorrecta atrae a más alumnos que la
    // clave correcta. Señal fuerte de error conceptual extendido o ítem confuso.
    if (input.topDistractorCount > input.correctCount && input.correctCount >= 0) {
      flags.push('strong_distractor');
    }
    return flags;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Habilidades / fortalezas y brechas
  // ───────────────────────────────────────────────────────────────────────────

  private async buildSkills(
    db: Database,
    assessmentId: string,
    orgId: string,
    studentFilter: string[] | null,
    scaleConfig: unknown,
  ): Promise<AssessmentReportSkillRow[]> {
    if (studentFilter !== null && studentFilter.length === 0) return [];

    const conditions = [
      eq(skillResults.assessmentId, assessmentId),
      eq(students.orgId, orgId),
      isNull(students.deletedAt),
    ];
    if (studentFilter !== null) {
      conditions.push(inArray(skillResults.studentId, studentFilter));
    }

    const rows = await db
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

    const skills: AssessmentReportSkillRow[] = rows.map((r) => {
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

    // Brechas primero (menor logro). Habilidades sin datos al final.
    return skills.sort(
      (a, b) => (a.averageAchievement ?? 101) - (b.averageAchievement ?? 101),
    );
  }

  private buildHighlights(skills: AssessmentReportSkillRow[]): {
    strengths: string[];
    gaps: string[];
  } {
    const withData = skills.filter((s) => s.averageAchievement !== null);
    // skills viene ordenado asc por logro: las primeras son brechas, las últimas fortalezas.
    const gaps = withData.slice(0, 3).map((s) => s.nodeName);
    const strengths = withData
      .slice(-3)
      .reverse()
      .map((s) => s.nodeName);
    return { strengths, gaps };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Alumnos en foco
  // ───────────────────────────────────────────────────────────────────────────

  private async buildRiskStudents(
    db: Database,
    assessmentId: string,
    evaluated: EvaluatedStudent[],
    classGroupByStudent: Map<string, { id: string; name: string }>,
  ): Promise<AssessmentReportRiskStudent[]> {
    const atRisk = evaluated
      .filter((e) => e.performanceLevel && AT_RISK_LEVELS.includes(e.performanceLevel))
      .sort((a, b) => (a.percentage ?? 101) - (b.percentage ?? 101))
      .slice(0, 30);

    if (atRisk.length === 0) return [];

    const weakest = await this.loadWeakestSkillPerStudent(
      db,
      assessmentId,
      atRisk.map((e) => e.studentId),
    );

    return atRisk.map((e) => ({
      studentId: e.studentId,
      studentRut: e.studentRut,
      studentFullName: `${e.firstName} ${e.lastName}`.trim(),
      classGroupName: classGroupByStudent.get(e.studentId)?.name ?? null,
      achievement: e.percentage,
      performanceLevel: e.performanceLevel,
      weakestSkill: weakest.get(e.studentId) ?? null,
    }));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Recomendaciones (reglas — no IA en F1)
  // ───────────────────────────────────────────────────────────────────────────

  private buildRecommendations(
    summary: { averageAchievement: number | null; performanceLevel: PerformanceLevel | null },
    skills: AssessmentReportSkillRow[],
    items: AssessmentReportItemRow[],
    studentsAtRisk: AssessmentReportRiskStudent[],
  ): AssessmentReportRecommendation[] {
    const recs: AssessmentReportRecommendation[] = [];

    // 1. Reforzar habilidades con brecha (logro bajo). Hasta 3.
    for (const skill of skills.filter(
      (s) =>
        s.averageAchievement !== null &&
        (s.performanceLevel === 'insufficient' || s.performanceLevel === 'elementary'),
    )) {
      if (recs.filter((r) => r.type === 'reteach_skill').length >= 3) break;
      recs.push({
        type: 'reteach_skill',
        priority: skill.performanceLevel === 'insufficient' ? 'high' : 'medium',
        message: `Reforzar "${skill.nodeName}" (${(skill.averageAchievement ?? 0).toFixed(0)}% de logro): es una de las brechas prioritarias de esta evaluación.`,
      });
    }

    // 2. Revisar ítems con baja discriminación (posible problema de la pregunta).
    const flagged = items.filter((i) => i.flags.includes('low_discrimination'));
    if (flagged.length > 0) {
      const positions = flagged.slice(0, 5).map((i) => `N°${i.position}`).join(', ');
      recs.push({
        type: 'review_item',
        priority: 'medium',
        message: `Revisar la redacción/clave de ${flagged.length} pregunta(s) con baja discriminación (${positions}${flagged.length > 5 ? '…' : ''}): no distinguen bien a quienes dominan el contenido.`,
      });
    }

    // 3. Apoyo a alumnos en riesgo.
    if (studentsAtRisk.length > 0) {
      recs.push({
        type: 'support_students',
        priority: studentsAtRisk.length >= 10 ? 'high' : 'medium',
        message: `Diseñar una intervención remedial para ${studentsAtRisk.length} alumno(s) en nivel insuficiente o elemental; agrupar por la habilidad más débil de cada uno.`,
      });
    }

    // 4. Celebrar fortalezas si el desempeño global es bueno.
    if (
      summary.performanceLevel === 'adequate' ||
      summary.performanceLevel === 'advanced'
    ) {
      const strength = skills.filter((s) => s.averageAchievement !== null).at(-1);
      recs.push({
        type: 'celebrate',
        priority: 'low',
        message: strength
          ? `Buen desempeño global. Destaca "${strength.nodeName}" (${(strength.averageAchievement ?? 0).toFixed(0)}%): comunícalo y replica las prácticas que funcionaron.`
          : 'Buen desempeño global: comunica los resultados y consolida las prácticas que funcionaron.',
      });
    }

    return recs;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Queries de datos
  // ───────────────────────────────────────────────────────────────────────────

  /** Ítems del instrumento + skill/content representativos. */
  private async loadItemColumns(
    db: Database,
    instrumentId: string,
  ): Promise<ItemColumn[]> {
    const rows = await db
      .select({
        itemId: items.id,
        position: items.position,
        content: items.content,
      })
      .from(items)
      .where(and(eq(items.instrumentId, instrumentId), isNull(items.deletedAt)))
      .orderBy(asc(items.position));

    const itemIds = rows.map((r) => r.itemId);
    const tagsByItem = await this.loadTagsByItems(db, itemIds);

    return rows.map((r) => {
      const content = (r.content ?? {}) as ItemContent;
      const refs = tagsByItem.get(r.itemId) ?? { skill: null, contentRef: null };
      return {
        itemId: r.itemId,
        position: r.position,
        skillName: refs.skill,
        contentName: refs.contentRef,
        correctKey: this.deriveCorrectKey(content),
      };
    });
  }

  private async loadTagsByItems(
    db: Database,
    itemIds: string[],
  ): Promise<Map<string, { skill: string | null; contentRef: string | null }>> {
    const map = new Map<string, { skill: string | null; contentRef: string | null }>();
    if (itemIds.length === 0) return map;

    const rows = await db
      .select({
        itemId: itemTaxonomyTags.itemId,
        nodeName: taxonomyNodes.name,
        nodeType: sql<string>`${taxonomyNodes.type}::text`,
      })
      .from(itemTaxonomyTags)
      .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, itemTaxonomyTags.nodeId))
      .where(inArray(itemTaxonomyTags.itemId, itemIds))
      .orderBy(asc(itemTaxonomyTags.tagType));

    for (const r of rows) {
      let entry = map.get(r.itemId);
      if (!entry) {
        entry = { skill: null, contentRef: null };
        map.set(r.itemId, entry);
      }
      if (CONTENT_NODE_TYPES.includes(r.nodeType)) {
        if (!entry.contentRef) entry.contentRef = r.nodeName;
      } else {
        if (!entry.skill) entry.skill = r.nodeName;
      }
    }
    return map;
  }

  /** Alumnos con assessment_results en la evaluación dentro del scope. */
  private async loadEvaluatedStudents(
    db: Database,
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

    const rows = await db
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

  /** Curso de cada alumno relevante a la evaluación (enrollment ∩ assignment). */
  private async loadStudentClassGroups(
    db: Database,
    assessmentId: string,
    studentIds: string[],
  ): Promise<Map<string, { id: string; name: string }>> {
    const result = new Map<string, { id: string; name: string }>();
    if (studentIds.length === 0) return result;

    const rows = await db
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

  /** Cursos asignados a la evaluación, intersectados con el scope del caller. */
  private async loadAssessmentClassGroups(
    db: Database,
    assessmentId: string,
    orgId: string,
    scope: ScopeResult,
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

    const rows = await db
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

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      gradeName: r.gradeName ?? null,
    }));
  }

  /** Matriculados (distinct) en los cursos dados — base de la cobertura. */
  private async countEnrolled(
    db: Database,
    classGroupIds: string[],
  ): Promise<number> {
    if (classGroupIds.length === 0) return 0;
    const [row] = await db
      .select({
        total: sql<number>`count(distinct ${studentEnrollments.studentId})::int`,
      })
      .from(studentEnrollments)
      .innerJoin(students, eq(students.id, studentEnrollments.studentId))
      .where(
        and(
          inArray(studentEnrollments.classGroupId, classGroupIds),
          isNull(students.deletedAt),
        ),
      );
    return Number(row?.total ?? 0);
  }

  /**
   * Distribución de respuestas por ítem y alternativa (1 query group by).
   * Devuelve por ítem: total, respondidas (no en blanco), aciertos y el distractor
   * (alternativa incorrecta) más elegido.
   */
  private async loadItemDistribution(
    db: Database,
    assessmentId: string,
    itemIds: string[],
    studentFilter: string[] | null,
  ): Promise<Map<string, ItemDistribution>> {
    const result = new Map<string, ItemDistribution>();
    if (itemIds.length === 0) return result;
    if (studentFilter !== null && studentFilter.length === 0) return result;

    const conditions = [
      eq(responses.assessmentId, assessmentId),
      inArray(responses.itemId, itemIds),
    ];
    if (studentFilter !== null) {
      conditions.push(inArray(responses.studentId, studentFilter));
    }

    const answerExpr = sql<
      string | null
    >`nullif(coalesce(${responses.value}->>'raw', ${responses.value}->>'key', ${responses.value}->>'answer'), '')`;

    const rows = await db
      .select({
        itemId: responses.itemId,
        answer: answerExpr,
        isCorrect: sql<boolean>`coalesce(${responses.isCorrect}, false)`,
        count: sql<number>`count(*)::int`,
      })
      .from(responses)
      .where(and(...conditions))
      .groupBy(responses.itemId, answerExpr, responses.isCorrect);

    // Acumular por ítem: total, respondidas, aciertos y mejor distractor.
    const distractorByItem = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const count = Number(r.count);
      let entry = result.get(r.itemId);
      if (!entry) {
        entry = {
          totalResponses: 0,
          answeredCount: 0,
          correctCount: 0,
          topDistractorKey: null,
          topDistractorCount: 0,
        };
        result.set(r.itemId, entry);
      }
      entry.totalResponses += count;
      if (r.answer !== null) entry.answeredCount += count;
      if (r.isCorrect === true) {
        entry.correctCount += count;
      } else if (r.answer !== null) {
        // Distractor: alternativa marcada e incorrecta.
        const map = distractorByItem.get(r.itemId) ?? new Map<string, number>();
        map.set(r.answer, (map.get(r.answer) ?? 0) + count);
        distractorByItem.set(r.itemId, map);
      }
    }

    for (const [itemId, map] of distractorByItem) {
      const entry = result.get(itemId);
      if (!entry) continue;
      let bestKey: string | null = null;
      let bestCount = 0;
      for (const [key, count] of map) {
        if (count > bestCount) {
          bestKey = key;
          bestCount = count;
        }
      }
      entry.topDistractorKey = bestKey;
      entry.topDistractorCount = bestCount;
    }

    return result;
  }

  /** Aciertos por ítem dentro de un grupo de alumnos (para discriminación). */
  private async loadGroupCorrectness(
    db: Database,
    assessmentId: string,
    itemIds: string[],
    studentIds: string[],
  ): Promise<Map<string, { correct: number; total: number }>> {
    const result = new Map<string, { correct: number; total: number }>();
    if (itemIds.length === 0 || studentIds.length === 0) return result;

    const rows = await db
      .select({
        itemId: responses.itemId,
        total: sql<number>`count(*)::int`,
        correct: sql<number>`sum(case when ${responses.isCorrect} = true then 1 else 0 end)::int`,
      })
      .from(responses)
      .where(
        and(
          eq(responses.assessmentId, assessmentId),
          inArray(responses.itemId, itemIds),
          inArray(responses.studentId, studentIds),
        ),
      )
      .groupBy(responses.itemId);

    for (const r of rows) {
      result.set(r.itemId, { correct: Number(r.correct), total: Number(r.total) });
    }
    return result;
  }

  /** Habilidad de menor logro por alumno (1 query, dedupe en JS). */
  private async loadWeakestSkillPerStudent(
    db: Database,
    assessmentId: string,
    studentIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (studentIds.length === 0) return result;

    const rows = await db
      .select({
        studentId: skillResults.studentId,
        nodeName: taxonomyNodes.name,
        percentage: skillResults.percentage,
      })
      .from(skillResults)
      .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, skillResults.nodeId))
      .where(
        and(
          eq(skillResults.assessmentId, assessmentId),
          inArray(skillResults.studentId, studentIds),
        ),
      )
      .orderBy(asc(skillResults.percentage));

    // rows viene ordenado asc por %: el primer nodo de cada alumno es el más débil.
    for (const r of rows) {
      if (!result.has(r.studentId)) {
        result.set(r.studentId, r.nodeName);
      }
    }
    return result;
  }

  private async resolvePassingGrade(
    db: Database,
    gradingScaleId: string | null,
  ): Promise<number> {
    if (!gradingScaleId) return DEFAULT_PASSING_GRADE;
    const [row] = await db
      .select({ passingGrade: gradingScales.passingGrade })
      .from(gradingScales)
      .where(eq(gradingScales.id, gradingScaleId))
      .limit(1);
    return row ? Number(row.passingGrade) : DEFAULT_PASSING_GRADE;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Scoping & multi-tenancy (replican los demás services de resultados)
  // ───────────────────────────────────────────────────────────────────────────

  private requireOrgId(user: JwtPayload): string {
    if (user.orgId) return user.orgId;
    throw new ForbiddenException('Usuario sin organización asociada');
  }

  private async requireAssessment(
    db: Database,
    user: JwtPayload,
    orgId: string,
    assessmentId: string,
  ): Promise<{
    id: string;
    name: string | null;
    instrumentId: string;
    instrumentName: string;
    instrumentType: string;
    subjectName: string | null;
    administeredAt: Date | null;
    gradingScaleId: string | null;
    gradingScaleConfig: unknown;
  }> {
    const [row] = await db
      .select({
        id: assessments.id,
        orgId: assessments.orgId,
        name: assessments.name,
        instrumentId: assessments.instrumentId,
        instrumentName: instruments.name,
        instrumentType: sql<string>`${instruments.type}::text`,
        subjectName: subjects.name,
        administeredAt: assessments.administeredAt,
        gradingScaleId: instruments.gradingScaleId,
        gradingScaleConfig: gradingScales.config,
      })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
      .leftJoin(gradingScales, eq(gradingScales.id, instruments.gradingScaleId))
      .where(and(eq(assessments.id, assessmentId), isNull(instruments.deletedAt)))
      .limit(1);

    if (!row || (!user.isPlatformAdmin && row.orgId !== orgId)) {
      throw new NotFoundException('Evaluación no encontrada');
    }
    return {
      id: row.id,
      name: row.name,
      instrumentId: row.instrumentId,
      instrumentName: row.instrumentName,
      instrumentType: row.instrumentType,
      subjectName: row.subjectName ?? null,
      administeredAt: row.administeredAt,
      gradingScaleId: row.gradingScaleId,
      gradingScaleConfig: row.gradingScaleConfig,
    };
  }

  private async getAccessibleClassGroupIds(
    db: Database,
    user: JwtPayload,
    orgId: string,
  ): Promise<ScopeResult> {
    if (user.isPlatformAdmin) return { scopeAll: true, classGroupIds: [] };
    if (userHasAnyRole(user.roles, ADMIN_LIKE_ROLES)) {
      return { scopeAll: true, classGroupIds: [] };
    }
    if (!userHasAnyRole(user.roles, RESULTS_VIEWER_ROLES)) {
      return { scopeAll: false, classGroupIds: [] };
    }

    const rows = await db
      .select({ classGroupId: subjectClasses.classGroupId })
      .from(teacherAssignments)
      .innerJoin(subjectClasses, eq(subjectClasses.id, teacherAssignments.subjectClassId))
      .innerJoin(classGroups, eq(classGroups.id, subjectClasses.classGroupId))
      .where(
        and(
          eq(teacherAssignments.userId, user.userId),
          eq(classGroups.orgId, orgId),
        ),
      );

    const ids = Array.from(new Set(rows.map((r) => r.classGroupId)));
    return { scopeAll: false, classGroupIds: ids };
  }

  private async assessmentTouchesScope(
    db: Database,
    assessmentId: string,
    classGroupIds: string[],
  ): Promise<boolean> {
    if (classGroupIds.length === 0) return false;
    const [row] = await db
      .select({ classGroupId: assessmentCourseAssignments.classGroupId })
      .from(assessmentCourseAssignments)
      .where(
        and(
          eq(assessmentCourseAssignments.assessmentId, assessmentId),
          inArray(assessmentCourseAssignments.classGroupId, classGroupIds),
        ),
      )
      .limit(1);
    return !!row;
  }

  private async classGroupInScope(
    db: Database,
    orgId: string,
    scope: ScopeResult,
    classGroupId: string,
  ): Promise<boolean> {
    if (scope.scopeAll) {
      const [cg] = await db
        .select({ id: classGroups.id })
        .from(classGroups)
        .where(and(eq(classGroups.id, classGroupId), eq(classGroups.orgId, orgId)))
        .limit(1);
      return !!cg;
    }
    return scope.classGroupIds.includes(classGroupId);
  }

  private async resolveAccessibleStudentIds(
    db: Database,
    orgId: string,
    scope: ScopeResult,
    classGroupId: string | undefined,
  ): Promise<string[] | null> {
    if (scope.scopeAll && !classGroupId) return null;

    let allowedClassGroupIds: string[];
    if (scope.scopeAll) {
      allowedClassGroupIds = [classGroupId!];
    } else if (classGroupId) {
      if (!scope.classGroupIds.includes(classGroupId)) return [];
      allowedClassGroupIds = [classGroupId];
    } else {
      allowedClassGroupIds = scope.classGroupIds;
    }
    if (allowedClassGroupIds.length === 0) return [];

    const rows = await db
      .select({ studentId: studentEnrollments.studentId })
      .from(studentEnrollments)
      .innerJoin(students, eq(students.id, studentEnrollments.studentId))
      .where(
        and(
          inArray(studentEnrollments.classGroupId, allowedClassGroupIds),
          eq(students.orgId, orgId),
          isNull(students.deletedAt),
        ),
      );
    return Array.from(new Set(rows.map((r) => r.studentId)));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Parsing & util
  // ───────────────────────────────────────────────────────────────────────────

  private deriveCorrectKey(content: ItemContent): string | null {
    if (typeof content.correctKey === 'string' && content.correctKey.length > 0) {
      return content.correctKey;
    }
    if (!Array.isArray(content.alternatives)) return null;
    for (const raw of content.alternatives) {
      if (!raw || typeof raw !== 'object') continue;
      const alt = raw as ItemAlternative;
      if (alt.isCorrect === true && typeof alt.key === 'string') return alt.key;
    }
    return null;
  }

  private emptyDistribution(): PerformanceDistributionBucket[] {
    return PERFORMANCE_LEVELS_ORDER.map((level) => ({
      level,
      count: 0,
      percentage: 0,
    }));
  }

  private emptyItemRow(col: ItemColumn): AssessmentReportItemRow {
    return {
      itemId: col.itemId,
      position: col.position,
      skillName: col.skillName,
      contentName: col.contentName,
      correctKey: col.correctKey,
      answeredCount: 0,
      blankCount: 0,
      totalResponses: 0,
      difficulty: null,
      discrimination: null,
      topDistractorKey: null,
      topDistractorRate: null,
      flags: [],
    };
  }
}

// ── Tipos internos ────────────────────────────────────────────────────────────

type EvaluatedStudent = {
  studentId: string;
  studentRut: string;
  firstName: string;
  lastName: string;
  percentage: number | null;
  grade: number | null;
  performanceLevel: PerformanceLevel | null;
};

type ItemColumn = {
  itemId: string;
  position: number;
  skillName: string | null;
  contentName: string | null;
  correctKey: string | null;
};

type ItemDistribution = {
  totalResponses: number;
  answeredCount: number;
  correctCount: number;
  topDistractorKey: string | null;
  topDistractorCount: number;
};

function avg(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
