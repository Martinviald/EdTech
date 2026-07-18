import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import {
  assessmentCourseAssignments,
  assessmentItemStats,
  assessmentResults,
  assessmentSkillStats,
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
  RESULT_HIDDEN_NODE_TYPES,
  bandToLegacyLevel,
  capabilitiesFor,
  classifyByBands,
  mergeAnswerCounts,
  percentageToPerformanceLevel,
  userHasAnyRole,
  type AnswerCount,
  type AssessmentReportCourseRow,
  type AssessmentReportItemRow,
  type AssessmentReportQueryDto,
  type AssessmentReportRecommendation,
  type AssessmentReportResponse,
  type AssessmentReportRiskStudent,
  type AssessmentReportSkillRow,
  type DataGranularity,
  type ItemReportFlag,
  type PerformanceBandDistributionBucket,
  type PerformanceBandInput,
  type PerformanceBandView,
  type PerformanceDistributionBucket,
  type PerformanceLevel,
  type UserRole,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
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
import { InjectDb, type Database } from '../database/database.types';
import { loadInstrumentBands } from '../performance-bands/lib/load-instrument-bands';

/** PerformanceBandInput (con thresholds) → vista mínima para la respuesta. */
function toBandView(b: PerformanceBandInput): PerformanceBandView {
  return { key: b.key, label: b.label, order: b.order, color: b.color ?? null };
}

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
          throw new ForbiddenException('No tiene acceso a los resultados de esta evaluación');
        }
      }
      if (query.classGroupId) {
        const ok = await this.classGroupInScope(tx, orgId, scope, query.classGroupId);
        if (!ok) throw new ForbiddenException('No tiene acceso a ese curso');
      }

      // Dos resoluciones del MISMO scope, para las dos capas del informe (mismo
      // patrón y misma semántica que `ItemAnalysisService.getMatrix`):
      //  · classGroupFilter → la capa agregable (read-model de cohorte, grano curso).
      //  · studentFilter    → lo irreducible sobre `responses` (la discriminación
      //    necesita el puntaje de cada alumno para partir la cohorte en 27%/27%).
      // `null` significa lo mismo en ambas: scopeAll sin filtro.
      const classGroupFilter = this.resolveAccessibleClassGroupIds(scope, query.classGroupId);
      const studentFilter = await this.resolveAccessibleStudentIds(
        tx,
        orgId,
        scope,
        query.classGroupId,
      );

      // TKT-04 — `passingGrade` es `null` cuando el instrumento no tiene escala de
      // notas configurada. `hasGradingScale` lo expone explícitamente en el
      // contrato para que la UI oculte los campos de nota en vez de mostrar 4.0.
      const passingGrade = await this.resolvePassingGrade(tx, assessment.gradingScaleId);
      const hasGradingScale = passingGrade !== null;

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

      // Bandas del instrumento (el informe es siempre de un único instrumento):
      // fuente de verdad del nivel. Corre dentro de withOrgContext → RLS trae
      // globales + override de la org. Sin bandas → modo legacy (4 niveles).
      const bands = await loadInstrumentBands(tx, assessment.instrumentId);
      const bandView = bands.length > 0 ? bands.map(toBandView) : undefined;

      // Resuelve la banda de cada alumno UNA vez, para que las 3 vistas que la usan
      // (distribución, comparativa por curso, alumnos en foco) no la re-deriven cada
      // una a su manera. Ver `hydrateBands`: para el dato granular es exactamente el
      // `classifyByBands(percentage)` de siempre.
      this.hydrateBands(evaluated, bands);

      const meta = {
        assessmentId: assessment.id,
        assessmentName: assessment.name,
        instrumentId: assessment.instrumentId,
        instrumentName: assessment.instrumentName,
        instrumentType: assessment.instrumentType,
        subjectName: assessment.subjectName,
        gradeName,
        administeredAt: assessment.administeredAt,
        classGroups: reportClassGroups.map((c) => ({ id: c.id, name: c.name })),
        itemsCount: itemColumns.length,
        dataGranularity: assessment.dataGranularity,
        capabilities: [...capabilitiesFor(assessment.dataGranularity)],
        hasItemLevelData: assessment.dataGranularity === 'item_level',
      };

      // ── Capa agregable: ítems y habilidades ─────────────────────────────────
      // Se resuelven ANTES del corte por "sin alumnos evaluados" porque no dependen
      // de él: salen del read-model de cohorte, no de `assessment_results`. Un
      // informe oficial se puede cargar SIN los niveles por alumno (§9.5 del plan:
      // `students` es opcional en el importador, para no atar cada carga al OCR de
      // la Figura 1) — y en ese caso ésta es toda la analítica que existe. Calcularla
      // después del corte la habría tirado a la basura y devuelto un informe de ceros
      // teniendo los datos en la mano.
      const items = await this.buildItemAnalysis(
        tx,
        query.assessmentId,
        itemColumns,
        itemIds,
        evaluated,
        classGroupFilter,
      );
      const skills = await this.buildSkills(
        tx,
        query.assessmentId,
        classGroupFilter,
        assessment.gradingScaleConfig,
        bands,
      );
      const highlights = this.buildHighlights(skills);

      // Caso sin alumnos evaluados: informe vacío pero bien formado.
      if (evaluated.length === 0) {
        // Informe oficial cargado en modo agregado (sin niveles por alumno): no hay
        // `assessment_results`, pero el logro global del curso y el N de la cohorte SÍ
        // salen del read-model de ítems (Σ score_sum / Σ max_sum, y Σ del max de
        // student_count por curso). Sin esto la síntesis ejecutiva (logro promedio,
        // cobertura) saldría en blanco teniendo el dato agregado en la mano. La
        // distribución por nivel sigue dependiendo del dato por alumno / de la Figura 1
        // y queda fuera de esta capa. (Un informe agregado CON niveles por alumno cae
        // en el camino normal de abajo, que ya distribuye por banda; ver spec §8.5.)
        const aggregateAchievement: CohortOverallAchievement | null =
          assessment.dataGranularity === 'aggregate_only'
            ? await loadCohortOverallAchievement(tx, query.assessmentId, classGroupFilter)
            : null;

        return {
          meta,
          summary: aggregateAchievement
            ? this.buildAggregateSummary(
                aggregateAchievement,
                studentsEnrolled,
                passingGrade,
                assessment.gradingScaleConfig,
                bands,
              )
            : {
                studentsEvaluated: 0,
                studentsEnrolled,
                coverageRate: studentsEnrolled > 0 ? 0 : null,
                averageAchievement: null,
                hasGradingScale,
                averageGrade: null,
                passingGrade,
                passingRate: null,
                performanceLevel: null,
              },
          distribution: this.emptyDistribution(),
          ...(bandView ? { bands: bandView, bandDistribution: [] } : {}),
          courseComparison: [],
          skills,
          highlights,
          items,
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
        bands,
      );
      const distribution = this.buildDistribution(evaluated);
      const bandDistribution =
        bands.length > 0 ? this.buildBandDistribution(evaluated, bands) : undefined;

      // ── Comparativa por curso ───────────────────────────────────────────────
      const courseComparison = this.buildCourseComparison(
        evaluated,
        classGroupByStudent,
        passingGrade,
        summary.averageAchievement,
      );

      // ── Alumnos en foco ─────────────────────────────────────────────────────
      const studentsAtRisk = await this.buildRiskStudents(
        tx,
        query.assessmentId,
        evaluated,
        classGroupByStudent,
      );

      // ── Recomendaciones (reglas) ────────────────────────────────────────────
      const recommendations = this.buildRecommendations(summary, skills, items, studentsAtRisk);

      return {
        meta,
        summary,
        distribution,
        ...(bandView ? { bands: bandView, bandDistribution } : {}),
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

  /**
   * Resuelve, para cada alumno, la banda de logro del instrumento — y con datos
   * agregados también su nivel legacy, que el importador deja NULL.
   *
   * Con dato granular esto es EXACTAMENTE lo de siempre: `classifyByBands` sobre el
   * `percentage` del alumno. La rama nueva sólo puede tocar filas que hoy no aportan
   * a ningún número, porque exige las tres condiciones a la vez: sin `percentage`,
   * sin `performanceLevel` y con `performance_band_id`. Ésa es, por construcción, la
   * fila que escribe el importador de informes oficiales (§6.3 del plan: `metric_type
   * = 'band'`, `percentage` NULL) y nadie más.
   *
   * Sin esto, `student_levels` —capacidad que el modelo declara disponible con datos
   * agregados— era mentira en este endpoint: la distribución por banda se derivaba
   * re-clasificando `percentage`, que en un informe oficial es NULL, así que el
   * gráfico principal salía en cero teniendo la banda de cada alumno guardada en la
   * fila. Es el gráfico que el informe DIA existe para reproducir.
   */
  private hydrateBands(evaluated: EvaluatedStudent[], bands: PerformanceBandInput[]): void {
    if (bands.length === 0) return;
    for (const e of evaluated) {
      if (e.percentage !== null) {
        e.band = classifyByBands(e.percentage / 100, bands);
        continue;
      }
      if (e.performanceLevel !== null || e.performanceBandId === null) continue;
      const band = bands.find((b) => b.id === e.performanceBandId) ?? null;
      if (!band) continue;
      e.band = band;
      e.performanceLevel = bandToLegacyLevel(band, bands);
    }
  }

  private buildSummary(
    evaluated: EvaluatedStudent[],
    studentsEnrolled: number,
    passingGrade: number | null,
    scaleConfig: unknown,
    bands: PerformanceBandInput[],
  ) {
    // TKT-04 — sin escala configurada (`passingGrade === null`): no se reporta
    // ningún campo de nota (averageGrade/passingGrade/passingRate quedan null); el
    // % de logro y el nivel de desempeño sí, porque no dependen de la escala.
    const hasGradingScale = passingGrade !== null;

    const pcts = evaluated.map((e) => e.percentage).filter((p): p is number => p !== null);
    const grades = evaluated.map((e) => e.grade).filter((g): g is number => g !== null);

    const averageAchievement = pcts.length > 0 ? avg(pcts) : null;
    const averageGrade = hasGradingScale && grades.length > 0 ? avg(grades) : null;
    const passingRate =
      hasGradingScale && grades.length > 0
        ? (grades.filter((g) => g >= passingGrade!).length / grades.length) * 100
        : null;
    const coverageRate = studentsEnrolled > 0 ? (evaluated.length / studentsEnrolled) * 100 : null;

    const band =
      averageAchievement === null ? null : classifyByBands(averageAchievement / 100, bands);

    return {
      studentsEvaluated: evaluated.length,
      studentsEnrolled,
      coverageRate,
      averageAchievement,
      hasGradingScale,
      averageGrade,
      passingGrade,
      passingRate,
      performanceLevel:
        averageAchievement === null
          ? null
          : band
            ? bandToLegacyLevel(band, bands)
            : percentageToPerformanceLevel(averageAchievement / 100, {
                config: scaleConfig as never,
              }),
      performanceBand: band ? toBandView(band) : null,
    };
  }

  /**
   * Síntesis ejecutiva para un informe cargado en modo agregado (sin filas por
   * alumno). El logro promedio y el N vienen del read-model de ítems; los campos de
   * nota no aplican (un informe oficial no trae puntajes crudos). La distribución por
   * nivel se resuelve aparte (queda vacía hasta cargar los niveles / la Figura 1).
   */
  private buildAggregateSummary(
    aggregate: CohortOverallAchievement,
    studentsEnrolled: number,
    passingGrade: number | null,
    scaleConfig: unknown,
    bands: PerformanceBandInput[],
  ) {
    const hasGradingScale = passingGrade !== null;
    const averageAchievement = aggregate.averageAchievement;
    const studentsEvaluated = aggregate.studentsAssessed;
    const coverageRate = studentsEnrolled > 0 ? (studentsEvaluated / studentsEnrolled) * 100 : null;
    const band =
      averageAchievement === null ? null : classifyByBands(averageAchievement / 100, bands);
    return {
      studentsEvaluated,
      studentsEnrolled,
      coverageRate,
      averageAchievement,
      hasGradingScale,
      averageGrade: null,
      passingGrade,
      passingRate: null,
      performanceLevel:
        averageAchievement === null
          ? null
          : band
            ? bandToLegacyLevel(band, bands)
            : percentageToPerformanceLevel(averageAchievement / 100, {
                config: scaleConfig as never,
              }),
      performanceBand: band ? toBandView(band) : null,
    };
  }

  private buildDistribution(evaluated: EvaluatedStudent[]): PerformanceDistributionBucket[] {
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

  /** Distribución por banda del instrumento (ver `hydrateBands`). */
  private buildBandDistribution(
    evaluated: EvaluatedStudent[],
    bands: PerformanceBandInput[],
  ): PerformanceBandDistributionBucket[] {
    const counts = new Map<string, number>();
    let total = 0;
    for (const e of evaluated) {
      if (!e.band) continue;
      counts.set(e.band.key, (counts.get(e.band.key) ?? 0) + 1);
      total += 1;
    }
    return [...bands]
      .sort((a, b) => a.order - b.order)
      .map((b) => {
        const count = counts.get(b.key) ?? 0;
        return {
          key: b.key,
          label: b.label,
          order: b.order,
          color: b.color ?? null,
          count,
          percentage: total > 0 ? (count / total) * 100 : 0,
        };
      });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Comparativa por curso (intra-evaluación)
  // ───────────────────────────────────────────────────────────────────────────

  private buildCourseComparison(
    evaluated: EvaluatedStudent[],
    classGroupByStudent: Map<string, { id: string; name: string }>,
    passingGrade: number | null,
    overallAchievement: number | null,
  ): AssessmentReportCourseRow[] {
    const byCourse = new Map<
      string,
      { name: string; evaluated: number; pcts: number[]; grades: number[]; critical: number }
    >();
    for (const e of evaluated) {
      const cg = classGroupByStudent.get(e.studentId);
      if (!cg) continue;
      let entry = byCourse.get(cg.id);
      if (!entry) {
        entry = { name: cg.name, evaluated: 0, pcts: [], grades: [], critical: 0 };
        byCourse.set(cg.id, entry);
      }
      entry.evaluated += 1;
      if (e.percentage !== null) entry.pcts.push(e.percentage);
      if (e.grade !== null) entry.grades.push(e.grade);
      if (e.performanceLevel && AT_RISK_LEVELS.includes(e.performanceLevel)) {
        entry.critical += 1;
      }
    }

    const rows: AssessmentReportCourseRow[] = [];
    for (const [classGroupId, entry] of byCourse) {
      const averageAchievement = entry.pcts.length > 0 ? avg(entry.pcts) : null;
      // TKT-04 — sin escala (passingGrade null) no hay tasa de aprobación por curso.
      const passingRate =
        passingGrade !== null && entry.grades.length > 0
          ? (entry.grades.filter((g) => g >= passingGrade).length / entry.grades.length) * 100
          : null;
      rows.push({
        classGroupId,
        classGroupName: entry.name,
        // Alumnos con resultado en el curso, NO los que traen `percentage`: un
        // informe oficial entrega el nivel de cada alumno sin su %, y contar por
        // `pcts` habría reportado "0 alumnos evaluados" en un curso con resultados.
        // Es además la misma definición que `summary.studentsEvaluated`, que ya
        // contaba filas; sólo pueden diferir donde hoy ya se contradicen en pantalla.
        studentsEvaluated: entry.evaluated,
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
    return rows.sort((a, b) => (b.averageAchievement ?? -1) - (a.averageAchievement ?? -1));
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
    classGroupFilter: string[] | null,
  ): Promise<AssessmentReportItemRow[]> {
    if (itemIds.length === 0) return [];

    // Distribución de respuestas por ítem y alternativa (1 query) → dificultad +
    // distractor dominante. Sale del read-model de cohorte, que ambos escritores
    // pueblan (cálculo desde `responses` e importador de informes oficiales), así
    // que este informe deja de ser el tercer lugar que hace su propio `GROUP BY`
    // sobre `responses` — y funciona con las dos granularidades sin ramificar.
    const stats = await this.loadItemCohortStats(db, assessmentId, itemIds, classGroupFilter);

    // Discriminación: grupos alto/bajo (27%) por puntaje total. Es lo ÚNICO de esta
    // sección que sigue en `responses`: partir la cohorte en 27% superior/inferior
    // exige el puntaje de cada alumno, y eso no se deriva de conteos por curso. Con
    // datos agregados `evaluated` no trae `percentage` → `sorted` vacío → groupSize 0
    // → `discrimination: null` sin disparar ninguna query (y sin flag de baja
    // discriminación, que sería un falso positivo). Ver `meta.hasItemLevelData`.
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
      const s = stats.get(col.itemId);
      const answerCounts = s?.answerCounts ?? [];
      const totalResponses = s?.responseCount ?? 0;
      // El blanco es el bucket `key === null`; todo lo demás cuenta como respondido.
      // Paridad con el `GROUP BY` que reemplaza: `response_count` = el `count(*)` de
      // filas de respuesta, o sea los blancos siguen en el denominador.
      const answeredCount = answerCounts.reduce(
        (acc, b) => (b.key === null ? acc : acc + b.count),
        0,
      );
      const blankCount = totalResponses - answeredCount;
      const correctCount = s?.correctCount ?? 0;
      const difficulty = totalResponses > 0 ? (correctCount / totalResponses) * 100 : null;

      const top = topCorrect.get(col.itemId);
      const bottom = bottomCorrect.get(col.itemId);
      let discrimination: number | null = null;
      if (top && bottom && top.total > 0 && bottom.total > 0) {
        discrimination = top.correct / top.total - bottom.correct / bottom.total;
      }

      const { key: topDistractorKey, count: topDistractorCount } = this.pickTopDistractor(
        col,
        answerCounts,
      );
      const topDistractorRate =
        totalResponses > 0 && topDistractorKey ? (topDistractorCount / totalResponses) * 100 : null;

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

  /**
   * Alternativa incorrecta más elegida del ítem, desde los buckets del read-model.
   *
   * ⚠️ Sólo aplica a ítems CON alternativas, y el predicado es el MISMO que usa el
   * escritor del read-model (`result-aggregator.ts`): `content.alternatives` no vacío.
   * En un ítem de desarrollo la clave del bucket no es una alternativa marcada sino la
   * categoría por puntaje ('RC'|'RPC'|'RI'), así que sin este corte 'RI' pasaría por
   * "distractor dominante" y dispararía `strong_distractor` en preguntas que no tienen
   * distractores. Preserva exacto el comportamiento anterior: sobre `responses`, un
   * ítem de desarrollo daba `answer = null` y nunca entraba al conteo de distractores.
   *
   * `isCorrect` es el del bucket (lo fija el calculador puro con la precedencia
   * `correctKey ?? alt.isCorrect`), igual que el `coalesce(is_correct,false)` de la
   * fila de respuesta que se usaba antes.
   */
  private pickTopDistractor(
    col: ItemColumn,
    answerCounts: AnswerCount[],
  ): { key: string | null; count: number } {
    if (!col.hasAlternatives) return { key: null, count: 0 };

    const byKey = new Map<string, number>();
    for (const bucket of answerCounts) {
      if (bucket.key === null || bucket.isCorrect) continue;
      byKey.set(bucket.key, (byKey.get(bucket.key) ?? 0) + bucket.count);
    }

    let best: { key: string | null; count: number } = { key: null, count: 0 };
    for (const [key, count] of byKey) {
      if (count > best.count) best = { key, count };
    }
    return best;
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
    if (input.discrimination !== null && input.discrimination < DISCRIMINATION_LOW) {
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

  /**
   * Logro por habilidad desde el read-model de cohorte (`assessment_skill_stats`),
   * el mismo que leen los dashboards de habilidades y el heatmap desde la Fase 5 —
   * de modo que el informe y el heatmap ya no pueden discrepar sobre el mismo eje.
   *
   * La aritmética de recombinación NO se reimplementa acá: vive una sola vez en
   * `cohort-skill-stats.helper` (CLAUDE.md §4.2). Es un promedio PONDERADO por
   * `studentCount`, y esa ponderación es justo lo que lo hace numéricamente neutro
   * frente al `avg(skill_results.percentage)` que reemplaza: con `source='computed'`
   * el `percentage` del read-model es, por decisión §9.2 del plan, la media de los
   * porcentajes por alumno del curso, así que
   *   Σ_alumnos pct / N  =  Σ_curso (pct_curso × n_curso) / Σ_curso n_curso.
   * Un promedio simple de los cursos NO sería equivalente.
   *
   * `studentsAssessed` usa `max` por curso y se suma entre cursos (ver el helper).
   * Un informe es SIEMPRE de una única evaluación, que es el caso donde `max`
   * reproduce exacto el `count(distinct student_id)` anterior.
   */
  private async buildSkills(
    db: Database,
    assessmentId: string,
    classGroupFilter: string[] | null,
    scaleConfig: unknown,
    bands: PerformanceBandInput[],
  ): Promise<AssessmentReportSkillRow[]> {
    if (classGroupFilter !== null && classGroupFilter.length === 0) return [];

    const conditions = [
      eq(assessmentSkillStats.assessmentId, assessmentId),
      // TKT-05 — los descriptores no se reportan como habilidad/eje en resultados.
      notInArray(taxonomyNodes.type, [...RESULT_HIDDEN_NODE_TYPES]),
    ];
    if (classGroupFilter !== null) {
      conditions.push(inArray(assessmentSkillStats.classGroupId, classGroupFilter));
    }

    const rows = await db
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
      // El curso NO puede faltar del group by: es lo que hace correcto el `max` de
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

    const skills: AssessmentReportSkillRow[] = [...acc.entries()].map(([nodeId, a]) => {
      const averageAchievement = cohortAverage(a);
      const band =
        averageAchievement === null ? null : classifyByBands(averageAchievement / 100, bands);
      return {
        nodeId,
        ...meta.get(nodeId)!,
        studentsAssessed: a.studentsAssessed,
        averageAchievement,
        performanceLevel:
          averageAchievement === null
            ? null
            : band
              ? bandToLegacyLevel(band, bands)
              : percentageToPerformanceLevel(averageAchievement / 100, {
                  config: scaleConfig as never,
                }),
        performanceBand: band ? toBandView(band) : null,
      };
    });

    // Brechas primero (menor logro). Habilidades sin datos al final.
    return skills.sort((a, b) => (a.averageAchievement ?? 101) - (b.averageAchievement ?? 101));
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

    return atRisk.map((e) => {
      const band = e.band;
      return {
        studentId: e.studentId,
        studentRut: e.studentRut,
        studentFullName: `${e.firstName} ${e.lastName}`.trim(),
        classGroupName: classGroupByStudent.get(e.studentId)?.name ?? null,
        achievement: e.percentage,
        performanceLevel: e.performanceLevel,
        performanceBand: band ? toBandView(band) : null,
        weakestSkill: weakest.get(e.studentId) ?? null,
      };
    });
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
      const positions = flagged
        .slice(0, 5)
        .map((i) => `N°${i.position}`)
        .join(', ');
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
    if (summary.performanceLevel === 'adequate' || summary.performanceLevel === 'advanced') {
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
  private async loadItemColumns(db: Database, instrumentId: string): Promise<ItemColumn[]> {
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
        hasAlternatives: Array.isArray(content.alternatives) && content.alternatives.length > 0,
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
      // TKT-05 — un descriptor nunca es la habilidad/contenido representativo del
      // ítem en la vista de resultados (sí sigue disponible en el banco de ítems).
      if ((RESULT_HIDDEN_NODE_TYPES as readonly string[]).includes(r.nodeType)) {
        continue;
      }
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
        // Sólo lo usa `hydrateBands`, y sólo cuando no hay `percentage` que
        // clasificar: es la banda que el informe oficial trae ya decidida.
        performanceBandId: assessmentResults.performanceBandId,
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
      performanceBandId: r.performanceBandId ?? null,
      band: null,
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
  private async countEnrolled(db: Database, classGroupIds: string[]): Promise<number> {
    if (classGroupIds.length === 0) return 0;
    const [row] = await db
      .select({
        total: sql<number>`count(distinct ${studentEnrollments.studentId})::int`,
      })
      .from(studentEnrollments)
      .innerJoin(students, eq(students.id, studentEnrollments.studentId))
      .where(
        and(inArray(studentEnrollments.classGroupId, classGroupIds), isNull(students.deletedAt)),
      );
    return Number(row?.total ?? 0);
  }

  /**
   * Filas del read-model de cohorte (`assessment_item_stats`) recombinadas por ítem
   * (1 query). Devuelve por ítem: respuestas, aciertos y la distribución de buckets.
   *
   * ⚠️ Las cohortes se juntan SUMANDO conteos — nunca promediando porcentajes: los
   * cursos tienen distinto N y el promedio de porcentajes sería incorrecto (§2.2 del
   * plan). `mergeAnswerCounts` es la primitiva compartida del calculador puro, la
   * misma que usan `item-analysis` y `official-reports`; acá sólo se la alimenta.
   *
   * El filtro es por CURSO y no por alumno porque ése es el grano del read-model. Es
   * el mismo scope: `resolveAccessibleStudentIds` deriva sus alumnos de esos mismos
   * cursos vía `student_enrollments` (§2.4), así que la cohorte no cambia.
   */
  private async loadItemCohortStats(
    db: Database,
    assessmentId: string,
    itemIds: string[],
    classGroupFilter: string[] | null,
  ): Promise<Map<string, ItemCohortRow>> {
    const result = new Map<string, ItemCohortRow>();
    if (itemIds.length === 0) return result;
    if (classGroupFilter !== null && classGroupFilter.length === 0) return result;

    const conditions = [
      eq(assessmentItemStats.assessmentId, assessmentId),
      inArray(assessmentItemStats.itemId, itemIds),
    ];
    if (classGroupFilter !== null) {
      conditions.push(inArray(assessmentItemStats.classGroupId, classGroupFilter));
    }

    const rows = await db
      .select({
        itemId: assessmentItemStats.itemId,
        responseCount: assessmentItemStats.responseCount,
        correctCount: assessmentItemStats.correctCount,
        answerCounts: assessmentItemStats.answerCounts,
      })
      .from(assessmentItemStats)
      .where(and(...conditions));

    // Agrupar las cohortes por ítem antes de recombinar sus distribuciones.
    const bucketsByItem = new Map<string, AnswerCount[][]>();
    for (const r of rows) {
      let entry = result.get(r.itemId);
      if (!entry) {
        entry = { responseCount: 0, correctCount: 0, answerCounts: [] };
        result.set(r.itemId, entry);
        bucketsByItem.set(r.itemId, []);
      }
      entry.responseCount += Number(r.responseCount);
      entry.correctCount += Number(r.correctCount);
      bucketsByItem.get(r.itemId)!.push(r.answerCounts ?? []);
    }
    for (const [itemId, buckets] of bucketsByItem) {
      result.get(itemId)!.answerCounts = mergeAnswerCounts(buckets);
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
          // TKT-05 — la habilidad más débil de un alumno no puede ser un descriptor.
          notInArray(taxonomyNodes.type, [...RESULT_HIDDEN_NODE_TYPES]),
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

  /**
   * TKT-04 — passing_grade de la escala del instrumento, o `null` si el
   * instrumento NO tiene escala configurada (o la escala referenciada no existe).
   * `null` es la señal explícita de "sin escala": los consumidores anulan los
   * campos de nota en vez de inventar el default 4.0.
   */
  private async resolvePassingGrade(
    db: Database,
    gradingScaleId: string | null,
  ): Promise<number | null> {
    if (!gradingScaleId) return null;
    const [row] = await db
      .select({ passingGrade: gradingScales.passingGrade })
      .from(gradingScales)
      .where(eq(gradingScales.id, gradingScaleId))
      .limit(1);
    return row ? Number(row.passingGrade) : null;
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
    dataGranularity: DataGranularity;
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
        dataGranularity: assessments.dataGranularity,
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
      dataGranularity: row.dataGranularity as DataGranularity,
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
      .where(and(eq(teacherAssignments.userId, user.userId), eq(classGroups.orgId, orgId)));

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

  /**
   * classGroupIds visibles combinando scope + filtro por curso. `null` = scopeAll sin
   * filtro (sin filtro extra de curso).
   *
   * Es el scope de la capa AGREGABLE (read-model de cohorte, grano por curso). Espeja
   * `resolveAccessibleStudentIds` —el de la capa granular— para que ambas resuelvan
   * la MISMA cohorte: los alumnos de aquélla salen de estos mismos cursos vía
   * `student_enrollments` (§2.4 del plan). Idéntico a `ItemAnalysisService`.
   */
  private resolveAccessibleClassGroupIds(
    scope: ScopeResult,
    classGroupId: string | undefined,
  ): string[] | null {
    if (scope.scopeAll && !classGroupId) return null;
    if (scope.scopeAll) return [classGroupId!];
    if (classGroupId) {
      return scope.classGroupIds.includes(classGroupId) ? [classGroupId] : [];
    }
    return scope.classGroupIds;
  }

  /**
   * studentIds visibles combinando scope + filtro por curso. `null` = scopeAll sin
   * filtro. Sólo para lo irreducible sobre `responses` (la discriminación); la capa
   * agregable usa `resolveAccessibleClassGroupIds`.
   */
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
}

// ── Tipos internos ────────────────────────────────────────────────────────────

type EvaluatedStudent = {
  studentId: string;
  studentRut: string;
  firstName: string;
  lastName: string;
  percentage: number | null;
  grade: number | null;
  /** Con datos agregados lo rellena `hydrateBands` desde la banda del informe. */
  performanceLevel: PerformanceLevel | null;
  /** `performance_bands.id` de la fila; sólo viene con `metric_type='band'`. */
  performanceBandId: string | null;
  /** Banda resuelta por `hydrateBands`. */
  band: PerformanceBandInput | null;
};

type ItemColumn = {
  itemId: string;
  position: number;
  skillName: string | null;
  contentName: string | null;
  correctKey: string | null;
  /**
   * ¿El ítem ofrece alternativas? Predicado idéntico al del escritor del read-model
   * (`result-aggregator.ts`), del que depende que 'RC'/'RPC'/'RI' sean las claves de
   * bucket de un ítem de desarrollo. Ver `pickTopDistractor`.
   */
  hasAlternatives: boolean;
};

/** Fila del read-model de cohorte ya recombinada entre los cursos del scope. */
type ItemCohortRow = {
  responseCount: number;
  correctCount: number;
  answerCounts: AnswerCount[];
};

function avg(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
