import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import {
  academicYears,
  assessmentCourseAssignments,
  assessmentItemStats,
  assessmentResults,
  assessmentSkillStats,
  assessments,
  classGroups,
  gradingScales,
  grades,
  instruments,
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
  DEFAULT_PERFORMANCE_THRESHOLDS,
  PERFORMANCE_LEVELS,
  RESULTS_VIEWER_ROLES,
  RESULT_HIDDEN_NODE_TYPES,
  bandToLegacyLevel,
  buildComparabilityMeta,
  classifyByBands,
  percentageToPerformanceLevel,
  userHasAnyRole,
  type AssessmentStatus,
  type ComparabilityInstrumentRef,
  type DashboardAssessmentSummary,
  type DashboardFilterOptionsResponse,
  type DashboardFiltersQueryDto,
  type DashboardOverviewResponse,
  type DashboardPerformanceQueryDto,
  type DashboardPerformanceResponse,
  type DashboardSkillBreakdownQueryDto,
  type DashboardSkillBreakdownResponse,
  type DashboardSkillsResponse,
  type InstrumentApplicationPeriod,
  type SkillBreakdownRow,
  type DashboardTeacherKpisResponse,
  type PerformanceBandDistributionBucket,
  type PerformanceBandInput,
  type PerformanceBandView,
  type PerformanceDistributionBucket,
  type PerformanceLevel,
  type SkillAchievementModel,
  type StudentClassificationModel,
  type TeacherCourseKpiModel,
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
import { loadCohortAchievementByAssessment } from '../common/helpers/cohort-item-stats.helper';
import { InjectDb, type Database } from '../database/database.types';
import { loadInstrumentBands } from '../performance-bands/lib/load-instrument-bands';

/** PerformanceBandInput (con thresholds) → vista mínima para la respuesta. */
function toBandView(b: PerformanceBandInput): PerformanceBandView {
  return { key: b.key, label: b.label, order: b.order, color: b.color ?? null };
}

// Roles "administrativos" — ven todos los cursos de la org. Cualquier otro rol
// con acceso (teacher, homeroom_teacher) ve sólo los cursos donde tiene
// teacher_assignments activos. Mismo conjunto que assessment-results.service.
const ADMIN_LIKE_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
];

// Umbrales por defecto (0..1) — alineados al estándar DIA. Se usan cuando la
// grading scale aplicable no define `config.performanceThresholds`. Single source
// of truth en @soe/types (no duplicar literales 0.4/0.7/0.85).
const DEFAULT_THRESHOLDS = DEFAULT_PERFORMANCE_THRESHOLDS;

type Scope = { scopeAll: boolean; classGroupIds: string[] };

/**
 * Agregado por nodo, ya recombinado sobre el scope y antes de clasificar por
 * banda/nivel. Es el contrato interno que comparten los dos orígenes de `getSkills`:
 * el read-model de cohorte (camino normal) y `skill_results` (fallback por alumno).
 */
type SkillNodeAggregate = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  nodeCode: string | null;
  parentId: string | null;
  averageAchievement: number | null;
  studentsAssessed: number;
};

/** Agregado por fila del desglose (`getSkillBreakdown`), antes de derivar el nivel. */
type BreakdownAggregate = {
  id: string;
  label: string;
  sublabel: string | null;
  averageAchievement: number | null;
  studentsAssessed: number;
};

type ScopedAssessments = {
  ids: string[];
  refs: ComparabilityInstrumentRef[];
};

export type ComparableOverviewScope = {
  orgId: string;
  isTeacherScope: boolean;
  classGroupIds: string[] | null;
  assessmentIds: string[];
  refs: ComparabilityInstrumentRef[];
};

const EMPTY_RECENT_ASSESSMENTS = { data: [] as DashboardAssessmentSummary[], total: 0 };

const EMPTY_COMPARABILITY = buildComparabilityMeta([]);

@Injectable()
export class DashboardsService {
  constructor(@InjectDb() private readonly db: Database) {}

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/dashboards/overview  (H6.1 / H6.7)
  // ───────────────────────────────────────────────────────────────────────────

  async getOverview(
    user: JwtPayload,
    query: DashboardFiltersQueryDto,
  ): Promise<DashboardOverviewResponse> {
    const orgId = this.resolveOrgId(user);
    const isTeacherScope = this.isTeacherScope(user);
    const empty: DashboardOverviewResponse = {
      scope: isTeacherScope ? 'teacher' : 'org',
      studentsEvaluated: 0,
      assessmentsCount: 0,
      performanceDistribution: null,
      recentAssessments: [],
      recentAssessmentsTotal: 0,
      comparability: EMPTY_COMPARABILITY,
    };
    if (!orgId) return empty;

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await this.getAccessibleClassGroupIds(tx, user, orgId);
      if (!scope.scopeAll && scope.classGroupIds.length === 0) return empty;

      const studentIds = await this.resolveScopedStudentIds(tx, orgId, scope, query);
      if (studentIds !== null && studentIds.length === 0) return empty;

      const scoped = await this.resolveScopedAssessments(tx, orgId, query);
      const assessmentIds = scoped.ids;
      if (assessmentIds.length === 0) {
        return { ...empty, scope: isTeacherScope ? 'teacher' : 'org' };
      }

      const comparability = buildComparabilityMeta(scoped.refs, assessmentIds.length);

      const resultConditions = this.buildResultConditions(assessmentIds, studentIds, undefined);

      // ── Parte per-alumno (`assessment_results`) — informes item_level ──────────
      // Sólo alumnos distintos evaluados: el "% de logro global" que este bloque
      // alimentaba ya no existe (#1C), porque promediaba instrumentos no comparables.
      const [metrics] = await tx
        .select({
          studentsEvaluated: sql<number>`count(distinct ${assessmentResults.studentId})::int`,
        })
        .from(assessmentResults)
        .innerJoin(students, eq(students.id, assessmentResults.studentId))
        .where(and(...resultConditions, isNull(students.deletedAt)));

      // AssessmentIds con datos per-alumno en el scope. Se usa para no doble-contar
      // contra el read-model de cohorte (un assessment computed escribe en ambos):
      // sus alumnos ya salen del `count(distinct)` de arriba.
      const resultAssessmentRows = await tx
        .selectDistinct({ assessmentId: assessmentResults.assessmentId })
        .from(assessmentResults)
        .innerJoin(students, eq(students.id, assessmentResults.studentId))
        .where(and(...resultConditions, isNull(students.deletedAt)));
      const resultAssessmentIds = new Set(resultAssessmentRows.map((r) => r.assessmentId));

      // ── Parte de cohorte (`assessment_item_stats`) — informes agregados ────────
      // Un informe oficial DIA cargado en modo aggregate_only no tiene filas per-alumno
      // pero sí read-model de cohorte. Su scope es por curso (no por alumno).
      const cohortClassGroupIds = await this.resolveScopedClassGroupIds(tx, orgId, scope, query);
      const cohortByAssessment = await loadCohortAchievementByAssessment(
        tx,
        assessmentIds,
        cohortClassGroupIds,
      );

      const nResults = Number(metrics?.studentsEvaluated ?? 0);

      // Acumula SÓLO los assessment agregados (los que no aparecen en
      // `assessment_results`) para no doble-contar los computed.
      const cohortAssessmentIds = new Set<string>();
      let cohortStudents = 0; // Σ N_curso de los agregados (para studentsEvaluated)
      for (const c of cohortByAssessment) {
        cohortAssessmentIds.add(c.assessmentId);
        // Alumnos: sólo los de evaluaciones sin NINGUNA fila por alumno (si las hay,
        // esos alumnos ya están en `nResults` y sumarlos los duplicaría).
        if (!resultAssessmentIds.has(c.assessmentId)) {
          cohortStudents += c.studentsAssessed;
        }
      }

      // assessmentsCount = UNIÓN de assessment con datos per-alumno y con read-model de
      // cohorte, sin doble-contar los que están en ambos (Set).
      const assessmentsCount = new Set([...resultAssessmentIds, ...cohortAssessmentIds]).size;

      // studentsEvaluated = alumnos distintos de results + N de cohorte de los agregados.
      // ⚠️ Los informes agregados no tienen identidad de alumno, así que su N es un
      // conteo de cohorte (Σ del max(studentCount) por curso). Un alumno del mismo curso
      // evaluado en dos instrumentos agregados puede contarse dos veces: leve
      // sobreconteo aceptable en un KPI de landing.
      const studentsEvaluated = nResults + cohortStudents;

      // La distribución por nivel mezcla los cortes de cada instrumento cuando el
      // alcance no es comparable, así que sólo se emite sobre una unidad agregable (#1C).
      const distribution = comparability.aggregatable
        ? await this.computePerformanceDistribution(tx, assessmentIds, studentIds)
        : null;

      const recentAssessments = await this.loadRecentAssessments(
        tx,
        orgId,
        scope,
        query,
        studentIds,
      );

      return {
        scope: isTeacherScope ? 'teacher' : 'org',
        studentsEvaluated,
        assessmentsCount,
        performanceDistribution: distribution,
        recentAssessments: recentAssessments.data,
        recentAssessmentsTotal: recentAssessments.total,
        comparability,
      };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/dashboards/filters  (H6.2)
  // ───────────────────────────────────────────────────────────────────────────

  async getFilterOptions(
    user: JwtPayload,
    query: DashboardFiltersQueryDto,
  ): Promise<DashboardFilterOptionsResponse> {
    const orgId = this.resolveOrgId(user);
    const empty: DashboardFilterOptionsResponse = {
      subjects: [],
      grades: [],
      classGroups: [],
      periods: [],
      instruments: [],
      applicationPeriodsWithData: [],
      defaultAcademicYearId: null,
    };
    if (!orgId) return empty;

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await this.getAccessibleClassGroupIds(tx, user, orgId);
      if (!scope.scopeAll && scope.classGroupIds.length === 0) {
        // Profesor sin cursos: igual exponemos los períodos de la org para que la
        // UI no quede sin contexto, pero sin cursos/asignaturas visibles.
        const periods = await this.loadPeriods(orgId);
        return { ...empty, periods };
      }

      // Cursos visibles para el scope.
      const cgConditions = [eq(classGroups.orgId, orgId)];
      if (!scope.scopeAll) {
        cgConditions.push(inArray(classGroups.id, scope.classGroupIds));
      }

      // `class_groups` es POR año académico: sin acotar el año, el mismo curso
      // aparece una vez por cada año que exista y el dropdown se llena de
      // entradas indistinguibles ("A" de 2025 vs "A" de 2026). El catálogo se
      // resuelve siempre a UN año: el pedido, o el vigente, o —si ese no tiene
      // cursos— el más reciente que sí tenga.
      const academicYearId = await this.resolveCatalogAcademicYear(
        tx,
        orgId,
        query.academicYearId,
        cgConditions,
      );
      if (academicYearId) {
        cgConditions.push(eq(classGroups.academicYearId, academicYearId));
      }

      const classGroupRows = await tx
        .select({
          id: classGroups.id,
          name: classGroups.name,
          gradeId: classGroups.gradeId,
          academicYearId: classGroups.academicYearId,
          gradeName: grades.name,
        })
        .from(classGroups)
        .innerJoin(grades, eq(grades.id, classGroups.gradeId))
        .where(and(...cgConditions))
        .orderBy(classGroups.name);

      const visibleClassGroupIds = classGroupRows.map((r) => r.id);
      const gradeMap = new Map<string, string>();
      for (const r of classGroupRows) gradeMap.set(r.gradeId, r.gradeName);

      // Asignaturas visibles vía subject_classes de los cursos visibles.
      const subjectRows =
        visibleClassGroupIds.length === 0
          ? []
          : await tx
              .selectDistinct({ id: subjects.id, name: subjects.name })
              .from(subjectClasses)
              .innerJoin(subjects, eq(subjects.id, subjectClasses.subjectId))
              .where(inArray(subjectClasses.classGroupId, visibleClassGroupIds))
              .orderBy(subjects.name);

      // Instrumentos: oficiales (org_id null) + propios de la org, no borrados.
      const instrumentRows = await tx
        .select({
          id: instruments.id,
          name: instruments.name,
          type: instruments.type,
          subjectId: instruments.subjectId,
          gradeId: instruments.gradeId,
          applicationPeriod: instruments.applicationPeriod,
        })
        .from(instruments)
        .where(
          and(
            isNull(instruments.deletedAt),
            sql`(${instruments.orgId} = ${orgId} or ${instruments.orgId} is null)`,
          ),
        )
        .orderBy(instruments.name);

      const periods = await this.loadPeriods(orgId);

      // Momentos que REALMENTE tienen evaluaciones en el alcance visible. Dos cosas
      // que NO sirven acá:
      //  · el catálogo de `instruments` — un momento puede tener instrumentos
      //    oficiales y ninguna evaluación del colegio;
      //  · `visibleClassGroupIds` — está acotado a UN año académico (el del
      //    catálogo de cursos), y las evaluaciones de otros años quedarían fuera,
      //    marcando como "sin evaluaciones" un momento que sí devuelve filas.
      // Por eso se resuelven los cursos accesibles SIN filtro de año.
      const scopedCgRows = await tx
        .select({ id: classGroups.id })
        .from(classGroups)
        .where(
          and(
            eq(classGroups.orgId, orgId),
            ...(scope.scopeAll ? [] : [inArray(classGroups.id, scope.classGroupIds)]),
          ),
        );
      const scopedCgIds = scopedCgRows.map((r) => r.id);

      const periodRows =
        scopedCgIds.length === 0
          ? []
          : await tx
              .selectDistinct({ applicationPeriod: instruments.applicationPeriod })
              .from(assessments)
              .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
              .innerJoin(
                assessmentCourseAssignments,
                eq(assessmentCourseAssignments.assessmentId, assessments.id),
              )
              .where(
                and(
                  eq(assessments.orgId, orgId),
                  isNull(instruments.deletedAt),
                  inArray(assessmentCourseAssignments.classGroupId, scopedCgIds),
                ),
              );

      // T2-14/P3 — Instrumentos que REALMENTE tienen datos en el alcance visible: se
      // filtra el catálogo a los que tienen read-model de cohorte (`assessment_item_stats`,
      // el poblado por ambos escritores: cálculo desde `responses` e informes oficiales)
      // en alguno de los cursos accesibles. Así el selector de instrumento no ofrece
      // instrumentos oficiales sin evaluaciones o evaluaciones sin resultados, que
      // dejarían el dashboard en blanco al elegirlos.
      const dataInstrumentRows =
        scopedCgIds.length === 0
          ? []
          : await tx
              .selectDistinct({ instrumentId: assessments.instrumentId })
              .from(assessments)
              .innerJoin(assessmentItemStats, eq(assessmentItemStats.assessmentId, assessments.id))
              .where(
                and(
                  eq(assessments.orgId, orgId),
                  inArray(assessmentItemStats.classGroupId, scopedCgIds),
                ),
              );
      const instrumentIdsWithData = new Set(dataInstrumentRows.map((r) => r.instrumentId));

      return {
        applicationPeriodsWithData: periodRows
          .map((r) => r.applicationPeriod)
          .filter((p): p is InstrumentApplicationPeriod => p !== null),
        subjects: subjectRows.map((r) => ({ id: r.id, label: r.name })),
        grades: Array.from(gradeMap.entries()).map(([id, label]) => ({ id, label })),
        classGroups: classGroupRows.map((r) => ({
          id: r.id,
          label: r.name,
          gradeId: r.gradeId,
          academicYearId: r.academicYearId,
        })),
        periods,
        defaultAcademicYearId: academicYearId,
        instruments: instrumentRows
          .filter((r) => instrumentIdsWithData.has(r.id))
          .map((r) => ({
            id: r.id,
            label: r.name,
            type: r.type,
            subjectId: r.subjectId,
            gradeId: r.gradeId,
            applicationPeriod: r.applicationPeriod,
          })),
      };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/dashboards/performance  (H6.4)
  // ───────────────────────────────────────────────────────────────────────────

  async getPerformance(
    user: JwtPayload,
    query: DashboardPerformanceQueryDto,
  ): Promise<DashboardPerformanceResponse> {
    const orgId = this.resolveOrgId(user);
    const thresholds = {
      elementary: DEFAULT_THRESHOLDS.elementary,
      adequate: DEFAULT_THRESHOLDS.adequate,
      advanced: DEFAULT_THRESHOLDS.advanced,
    };
    const empty: DashboardPerformanceResponse = {
      distribution: null,
      thresholds,
      students: { data: [], total: 0, page: query.page, limit: query.limit },
      comparability: EMPTY_COMPARABILITY,
    };
    if (!orgId) return empty;

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await this.getAccessibleClassGroupIds(tx, user, orgId);
      if (!scope.scopeAll && scope.classGroupIds.length === 0) return empty;

      const studentIds = await this.resolveScopedStudentIds(tx, orgId, scope, query);
      if (studentIds !== null && studentIds.length === 0) return empty;

      const scoped = await this.resolveScopedAssessments(tx, orgId, query);
      const assessmentIds = scoped.ids;
      if (assessmentIds.length === 0) {
        return {
          ...empty,
          thresholds: await this.resolveThresholds(tx, orgId, query, assessmentIds),
        };
      }

      const resolvedThresholds = await this.resolveThresholds(tx, orgId, query, assessmentIds);
      const comparability = buildComparabilityMeta(scoped.refs, assessmentIds.length);

      // Clasificación por alumno: promediamos el % logro por alumno sobre el set de
      // evaluaciones que matchean los filtros. Una fila por alumno.
      const baseConditions = this.buildResultConditions(assessmentIds, studentIds, undefined);

      // Para filtrar por performanceLevel del promedio, calculamos el nivel a
      // partir del promedio (no del nivel por evaluación). El filtro se aplica
      // en SQL sobre el promedio para que la paginación sea consistente.
      const avgPct = sql`avg(${assessmentResults.percentage}::numeric)`;
      const avgGrade = sql`avg(${assessmentResults.grade}::numeric)`;

      const aggregateRows = await tx
        .select({
          studentId: assessmentResults.studentId,
          studentRut: students.rut,
          firstName: students.firstName,
          lastName: students.lastName,
          avgPct: sql<string | null>`${avgPct}`,
          avgGrade: sql<string | null>`${avgGrade}`,
        })
        .from(assessmentResults)
        .innerJoin(students, eq(students.id, assessmentResults.studentId))
        .where(and(...baseConditions, isNull(students.deletedAt)))
        .groupBy(assessmentResults.studentId, students.rut, students.firstName, students.lastName)
        .orderBy(students.lastName, students.firstName);

      // Enrollment → classGroup por alumno (para nombre de curso en la fila).
      const classGroupByStudent = await this.loadClassGroupByStudent(
        tx,
        orgId,
        scope,
        aggregateRows.map((r) => r.studentId),
      );

      const scaleThresholds = {
        elementary: resolvedThresholds.elementary,
        adequate: resolvedThresholds.adequate,
        advanced: resolvedThresholds.advanced,
      };

      // Bandas del instrumento cuando el scope es un único instrumento (ej. una
      // evaluación DIA): la clasificación usa el corte configurado, no 40/70/85.
      //
      // Si el alcance NO es agregable no se clasifica en absoluto (#1C): el promedio del
      // % de un alumno a través de instrumentos de distinta dificultad no tiene lectura
      // pedagógica, y clasificarlo con un corte que no es el de ninguno de ellos —el
      // viejo fallback silencioso a 40/70/85— era peor que no mostrarlo. La UI pide
      // elegir una unidad comparable con `comparability.reason`.
      const bands = comparability.aggregatable
        ? await this.resolveScopedBands(tx, query, assessmentIds)
        : null;

      let classified: StudentClassificationModel[] = aggregateRows.map((r) => {
        const pct = r.avgPct == null || !comparability.aggregatable ? null : Number(r.avgPct);
        const band = pct == null ? null : classifyByBands(pct / 100, bands);
        const level =
          pct == null
            ? null
            : band
              ? bandToLegacyLevel(band, bands!)
              : percentageToPerformanceLevel(pct / 100, { performanceThresholds: scaleThresholds });
        const cg = classGroupByStudent.get(r.studentId) ?? null;
        return {
          studentId: r.studentId,
          studentRut: r.studentRut,
          studentFullName: `${r.firstName} ${r.lastName}`.trim(),
          classGroupId: cg?.id ?? null,
          classGroupName: cg?.name ?? null,
          achievement: pct,
          grade: r.avgGrade == null ? null : Number(r.avgGrade).toFixed(2),
          performanceLevel: level,
          performanceBand: band ? toBandView(band) : null,
        };
      });

      // Distribución por nivel: se calcula sobre la MISMA clasificación por alumno
      // (promedio) que alimenta la tabla, para que seleccionar un badge coincida
      // exactamente con el conteo de la gráfica. Antes se contaba por resultado
      // (alumno × evaluación), lo que producía discrepancias cuando el promedio del
      // alumno caía en un nivel distinto al de alguna de sus evaluaciones.
      const classifiedTotal = classified.filter((c) => c.performanceLevel != null).length;
      const countByLevel = new Map<PerformanceLevel, number>();
      for (const c of classified) {
        if (c.performanceLevel == null) continue;
        countByLevel.set(c.performanceLevel, (countByLevel.get(c.performanceLevel) ?? 0) + 1);
      }
      const distribution: PerformanceDistributionBucket[] | null = comparability.aggregatable
        ? PERFORMANCE_LEVELS.map((level) => {
            const count = countByLevel.get(level) ?? 0;
            return {
              level,
              count,
              percentage: classifiedTotal > 0 ? (count / classifiedTotal) * 100 : 0,
            };
          })
        : null;

      // Distribución por banda del instrumento (N niveles reales) cuando aplica.
      let bandDistribution: PerformanceBandDistributionBucket[] | undefined;
      if (bands) {
        const withBand = classified.filter((c) => c.performanceBand != null).length;
        const countByBand = new Map<string, number>();
        for (const c of classified) {
          if (c.performanceBand == null) continue;
          countByBand.set(c.performanceBand.key, (countByBand.get(c.performanceBand.key) ?? 0) + 1);
        }
        bandDistribution = bands.map((b) => {
          const count = countByBand.get(b.key) ?? 0;
          return {
            key: b.key,
            label: b.label,
            order: b.order,
            color: b.color ?? null,
            count,
            percentage: withBand > 0 ? (count / withBand) * 100 : 0,
          };
        });
      }

      if (query.performanceLevel) {
        classified = classified.filter((c) => c.performanceLevel === query.performanceLevel);
      }

      const total = classified.length;
      const start = (query.page - 1) * query.limit;
      const pageData = classified.slice(start, start + query.limit);

      return {
        distribution,
        thresholds: resolvedThresholds,
        ...(bands ? { bands: bands.map(toBandView), bandDistribution } : {}),
        students: { data: pageData, total, page: query.page, limit: query.limit },
        comparability,
      };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/dashboards/skills  (H6.5)
  //
  // Lee el read-model de cohorte `assessment_skill_stats` (grano curso), no
  // `skill_results` (grano alumno). Así una evaluación cargada desde un informe
  // oficial DIA —que no tiene respuestas por alumno pero sí datos de cohorte—
  // alimenta esta vista por el MISMO camino que una evaluación calculada desde
  // `responses` (plan §5: un lector, dos escritores).
  //
  // La única excepción es el filtro `studentId`: acotar a UN alumno exige dato por
  // alumno, que es justo lo que el grano de cohorte no tiene. Ese caso cae al
  // camino histórico sobre `skill_results` — ver `loadSkillsFromSkillResults`.
  // ───────────────────────────────────────────────────────────────────────────

  async getSkills(
    user: JwtPayload,
    query: DashboardFiltersQueryDto,
  ): Promise<DashboardSkillsResponse> {
    const orgId = this.resolveOrgId(user);
    const empty: DashboardSkillsResponse = { skills: [], comparability: EMPTY_COMPARABILITY };
    if (!orgId) return empty;

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await this.getAccessibleClassGroupIds(tx, user, orgId);
      if (!scope.scopeAll && scope.classGroupIds.length === 0) return empty;

      const perStudent = this.requiresPerStudentData(query);
      const studentIds = perStudent
        ? await this.resolveScopedStudentIds(tx, orgId, scope, query)
        : null;
      if (studentIds !== null && studentIds.length === 0) return empty;

      const classGroupIds = perStudent
        ? null
        : await this.resolveScopedClassGroupIds(tx, orgId, scope, query);
      if (classGroupIds !== null && classGroupIds.length === 0) return empty;

      const scoped = await this.resolveScopedAssessments(tx, orgId, query);
      const assessmentIds = scoped.ids;
      if (assessmentIds.length === 0) return empty;

      const comparability = buildComparabilityMeta(scoped.refs, assessmentIds.length);

      // Thresholds de la escala aplicable (consistente con getPerformance/
      // getDistribution; antes getSkills usaba siempre defaults). Misma limitación
      // multi-escala documentada en resolveApplicableScale (F1 OK / revisar en F2).
      const resolvedThresholds = await this.resolveThresholds(tx, orgId, query, assessmentIds);
      const scaleThresholds = {
        elementary: resolvedThresholds.elementary,
        adequate: resolvedThresholds.adequate,
        advanced: resolvedThresholds.advanced,
      };

      const bands = comparability.aggregatable
        ? await this.resolveScopedBands(tx, query, assessmentIds)
        : null;

      const aggregates = perStudent
        ? await this.loadSkillsFromSkillResults(tx, assessmentIds, studentIds)
        : await this.loadSkillsFromCohortStats(tx, assessmentIds, classGroupIds);

      // Un mismo nodo de taxonomía se evalúa con ítems de dificultad muy distinta según
      // el instrumento, así que su % promedio a través de instrumentos no comparables no
      // mide una habilidad: mide una mezcla (#1C, D8). Se conservan los nodos y su N
      // —que son conteos— pero no el número que no se puede leer.
      const skills: SkillAchievementModel[] = aggregates.map((a) => {
        const pct = comparability.aggregatable ? a.averageAchievement : null;
        const band = pct == null ? null : classifyByBands(pct / 100, bands);
        return {
          nodeId: a.nodeId,
          nodeName: a.nodeName,
          nodeType: a.nodeType,
          nodeCode: a.nodeCode,
          parentId: a.parentId,
          studentsAssessed: a.studentsAssessed,
          averageAchievement: pct,
          performanceLevel:
            pct == null
              ? null
              : band
                ? bandToLegacyLevel(band, bands!)
                : percentageToPerformanceLevel(pct / 100, {
                    performanceThresholds: scaleThresholds,
                  }),
          performanceBand: band ? toBandView(band) : null,
        };
      });

      return bands
        ? { skills, bands: bands.map(toBandView), comparability }
        : { skills, comparability };
    });
  }

  /**
   * Agrega el read-model de cohorte por nodo sobre el scope.
   *
   * El `group by` incluye `class_group_id` a propósito: el promedio se recombina
   * ponderado por `studentCount` y los alumnos evaluados por curso se toman con `max`
   * sobre las evaluaciones (ver `cohort-skill-stats.helper`). Agregar directo por nodo
   * en SQL impediría ambas cosas.
   */
  private async loadSkillsFromCohortStats(
    tx: Database,
    assessmentIds: string[],
    classGroupIds: string[] | null,
  ): Promise<SkillNodeAggregate[]> {
    const conditions = [
      inArray(assessmentSkillStats.assessmentId, assessmentIds),
      // TKT-05 — la matriz de habilidades no reporta nodos tipo descriptor.
      notInArray(taxonomyNodes.type, [...RESULT_HIDDEN_NODE_TYPES]),
    ];
    if (classGroupIds !== null) {
      conditions.push(inArray(assessmentSkillStats.classGroupId, classGroupIds));
    }

    const rows = await tx
      .select({
        nodeId: assessmentSkillStats.nodeId,
        nodeName: taxonomyNodes.name,
        nodeType: taxonomyNodes.type,
        nodeCode: taxonomyNodes.code,
        parentId: taxonomyNodes.parentId,
        pctSum: COHORT_PCT_SUM,
        pctWeight: COHORT_PCT_WEIGHT,
        studentsAssessed: COHORT_STUDENTS_ASSESSED,
      })
      .from(assessmentSkillStats)
      .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, assessmentSkillStats.nodeId))
      .where(and(...conditions))
      .groupBy(
        assessmentSkillStats.nodeId,
        taxonomyNodes.name,
        taxonomyNodes.type,
        taxonomyNodes.code,
        taxonomyNodes.parentId,
        assessmentSkillStats.classGroupId,
      )
      .orderBy(taxonomyNodes.name);

    const acc = new Map<string, CohortAccumulator>();
    const meta = new Map<
      string,
      Omit<SkillNodeAggregate, 'averageAchievement' | 'studentsAssessed'>
    >();
    for (const r of rows) {
      addCohortRow(acc, r.nodeId, r);
      if (!meta.has(r.nodeId)) {
        meta.set(r.nodeId, {
          nodeId: r.nodeId,
          nodeName: r.nodeName,
          nodeType: r.nodeType,
          nodeCode: r.nodeCode,
          parentId: r.parentId,
        });
      }
    }

    // El orden de inserción del Map respeta el `orderBy(taxonomyNodes.name)`: todas las
    // filas de un nodo comparten nombre, así que la primera aparición ya viene ordenada.
    return [...acc.entries()].map(([nodeId, a]) => ({
      ...meta.get(nodeId)!,
      averageAchievement: cohortAverage(a),
      studentsAssessed: a.studentsAssessed,
    }));
  }

  /**
   * Camino histórico sobre `skill_results` (grano alumno). Sólo se usa cuando el query
   * trae `studentId`: el read-model de cohorte no puede acotar a un alumno.
   */
  private async loadSkillsFromSkillResults(
    tx: Database,
    assessmentIds: string[],
    studentIds: string[] | null,
  ): Promise<SkillNodeAggregate[]> {
    const conditions = [
      inArray(skillResults.assessmentId, assessmentIds),
      notInArray(taxonomyNodes.type, [...RESULT_HIDDEN_NODE_TYPES]),
    ];
    if (studentIds !== null) {
      conditions.push(inArray(skillResults.studentId, studentIds));
    }

    const rows = await tx
      .select({
        nodeId: skillResults.nodeId,
        nodeName: taxonomyNodes.name,
        nodeType: taxonomyNodes.type,
        nodeCode: taxonomyNodes.code,
        parentId: taxonomyNodes.parentId,
        avgPct: sql<string | null>`avg(${skillResults.percentage}::numeric)`,
        studentsAssessed: sql<number>`count(distinct ${skillResults.studentId})::int`,
      })
      .from(skillResults)
      .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, skillResults.nodeId))
      .where(and(...conditions))
      .groupBy(
        skillResults.nodeId,
        taxonomyNodes.name,
        taxonomyNodes.type,
        taxonomyNodes.code,
        taxonomyNodes.parentId,
      )
      .orderBy(taxonomyNodes.name);

    return rows.map((r) => ({
      nodeId: r.nodeId,
      nodeName: r.nodeName,
      nodeType: r.nodeType,
      nodeCode: r.nodeCode,
      parentId: r.parentId,
      averageAchievement: r.avgPct == null ? null : Number(r.avgPct),
      studentsAssessed: Number(r.studentsAssessed ?? 0),
    }));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/dashboards/skills/breakdown  (H6.5 — drill-down jerárquico)
  //
  // Desglosa el % de logro de UN nodo por la dimensión `groupBy`
  // (Asignatura/Nivel/Curso/Evaluación), respetando el mismo scoping y filtros de
  // getSkills. Cada fila devuelve la clave (`id`) para acotar el siguiente peldaño.
  // El leaf "→ preguntas" NO vive aquí: lo cubre /item-analysis/matrix (nodeId +
  // assessmentId, ya fijado por el peldaño Evaluación).
  // ───────────────────────────────────────────────────────────────────────────

  async getSkillBreakdown(
    user: JwtPayload,
    query: DashboardSkillBreakdownQueryDto,
  ): Promise<DashboardSkillBreakdownResponse> {
    const orgId = this.resolveOrgId(user);
    const emptyNode = {
      nodeId: query.nodeId,
      nodeName: '',
      nodeType: '',
      nodeCode: null as string | null,
    };
    if (!orgId) return { node: emptyNode, groupBy: query.groupBy, rows: [] };

    return withOrgContext(this.db, orgId, async (tx) => {
      const [nodeRow] = await tx
        .select({
          name: taxonomyNodes.name,
          type: taxonomyNodes.type,
          code: taxonomyNodes.code,
        })
        .from(taxonomyNodes)
        .where(eq(taxonomyNodes.id, query.nodeId))
        .limit(1);
      const node = nodeRow
        ? {
            nodeId: query.nodeId,
            nodeName: nodeRow.name,
            nodeType: nodeRow.type,
            nodeCode: nodeRow.code,
          }
        : emptyNode;
      const empty: DashboardSkillBreakdownResponse = { node, groupBy: query.groupBy, rows: [] };

      const scope = await this.getAccessibleClassGroupIds(tx, user, orgId);
      if (!scope.scopeAll && scope.classGroupIds.length === 0) return empty;

      const perStudent = this.requiresPerStudentData(query);
      const studentIds = perStudent
        ? await this.resolveScopedStudentIds(tx, orgId, scope, query)
        : null;
      if (studentIds !== null && studentIds.length === 0) return empty;

      const classGroupIds = perStudent
        ? null
        : await this.resolveScopedClassGroupIds(tx, orgId, scope, query);
      if (classGroupIds !== null && classGroupIds.length === 0) return empty;

      const assessmentIds = await this.resolveScopedAssessmentIds(tx, orgId, query);
      if (assessmentIds.length === 0) return empty;

      const resolvedThresholds = await this.resolveThresholds(tx, orgId, query, assessmentIds);
      const scaleThresholds = {
        elementary: resolvedThresholds.elementary,
        adequate: resolvedThresholds.adequate,
        advanced: resolvedThresholds.advanced,
      };
      const toLevel = (pct: number | null): PerformanceLevel | null =>
        pct == null
          ? null
          : percentageToPerformanceLevel(pct / 100, { performanceThresholds: scaleThresholds });

      const aggregates = perStudent
        ? await this.loadBreakdownFromSkillResults(
            tx,
            orgId,
            scope,
            query,
            assessmentIds,
            studentIds,
          )
        : await this.loadBreakdownFromCohortStats(tx, orgId, query, assessmentIds, classGroupIds);

      const rows: SkillBreakdownRow[] = aggregates.map((a) => ({
        id: a.id,
        label: a.label,
        sublabel: a.sublabel,
        averageAchievement: a.averageAchievement,
        performanceLevel: toLevel(a.averageAchievement),
        studentsAssessed: a.studentsAssessed,
      }));

      return { node, groupBy: query.groupBy, rows };
    });
  }

  /**
   * Desglose desde el read-model de cohorte. Las cuatro dimensiones comparten forma:
   * se agrupa por (dimensión × curso) y se recombina en memoria — el curso en el
   * `group by` es lo que permite ponderar el promedio y contar alumnos sin duplicar.
   *
   * `grade`/`classGroup` ya no pasan por `student_enrollments`: el read-model trae el
   * curso resuelto. Eso además elimina la duplicación por multi-matrícula que el camino
   * por alumno tenía que aceptar (un alumno con matrícula en dos años se contaba en los
   * dos cursos); acá el escritor le asigna un único curso (el del año más reciente).
   */
  private async loadBreakdownFromCohortStats(
    tx: Database,
    orgId: string,
    query: DashboardSkillBreakdownQueryDto,
    assessmentIds: string[],
    classGroupIds: string[] | null,
  ): Promise<BreakdownAggregate[]> {
    const base = [
      eq(assessmentSkillStats.nodeId, query.nodeId),
      inArray(assessmentSkillStats.assessmentId, assessmentIds),
    ];
    if (classGroupIds !== null) {
      base.push(inArray(assessmentSkillStats.classGroupId, classGroupIds));
    }

    const stats = {
      pctSum: COHORT_PCT_SUM,
      pctWeight: COHORT_PCT_WEIGHT,
      studentsAssessed: COHORT_STUDENTS_ASSESSED,
    };

    if (query.groupBy === 'assessment') {
      const raw = await tx
        .select({
          id: assessments.id,
          name: assessments.name,
          instrumentName: instruments.name,
          subjectName: subjects.name,
          ...stats,
        })
        .from(assessmentSkillStats)
        .innerJoin(assessments, eq(assessments.id, assessmentSkillStats.assessmentId))
        .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
        .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
        .where(and(...base))
        .groupBy(
          assessments.id,
          assessments.name,
          instruments.name,
          subjects.name,
          assessmentSkillStats.classGroupId,
        )
        .orderBy(desc(assessments.administeredAt), asc(assessments.createdAt));

      return this.foldBreakdown(raw, (r) => ({
        id: r.id,
        label: r.name ?? r.instrumentName,
        sublabel: r.subjectName,
      }));
    }

    if (query.groupBy === 'subject') {
      const raw = await tx
        .select({ id: subjects.id, name: subjects.name, ...stats })
        .from(assessmentSkillStats)
        .innerJoin(assessments, eq(assessments.id, assessmentSkillStats.assessmentId))
        .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
        .innerJoin(subjects, eq(subjects.id, instruments.subjectId))
        .where(and(...base))
        .groupBy(subjects.id, subjects.name, assessmentSkillStats.classGroupId)
        .orderBy(asc(subjects.name));

      return this.foldBreakdown(raw, (r) => ({ id: r.id, label: r.name, sublabel: null }));
    }

    // 'grade' | 'classGroup' — el curso del read-model se joinea directo.
    // `classGroupIds` ya trae aplicados el scope, `classGroupId`, `gradeId` y
    // `academicYearId`; el filtro por org es defensa en profundidad.
    const cgConditions = [...base, eq(classGroups.orgId, orgId)];

    if (query.groupBy === 'grade') {
      const raw = await tx
        .select({ id: grades.id, name: grades.name, ...stats })
        .from(assessmentSkillStats)
        .innerJoin(classGroups, eq(classGroups.id, assessmentSkillStats.classGroupId))
        .innerJoin(grades, eq(grades.id, classGroups.gradeId))
        .where(and(...cgConditions))
        .groupBy(grades.id, grades.name, assessmentSkillStats.classGroupId)
        .orderBy(asc(grades.name));

      return this.foldBreakdown(raw, (r) => ({ id: r.id, label: r.name, sublabel: null }));
    }

    const raw = await tx
      .select({
        id: classGroups.id,
        name: classGroups.name,
        gradeName: grades.name,
        ...stats,
      })
      .from(assessmentSkillStats)
      .innerJoin(classGroups, eq(classGroups.id, assessmentSkillStats.classGroupId))
      .innerJoin(grades, eq(grades.id, classGroups.gradeId))
      .where(and(...cgConditions))
      .groupBy(classGroups.id, classGroups.name, grades.name)
      .orderBy(asc(classGroups.name));

    return this.foldBreakdown(raw, (r) => ({
      id: r.id,
      label: r.name,
      sublabel: r.gradeName,
    }));
  }

  /**
   * Recombina las filas (dimensión × curso) del read-model en una fila por dimensión.
   * El orden de inserción del Map preserva el `orderBy` de la query: la clave de orden
   * es función de la dimensión, así que las filas de una misma dimensión son contiguas.
   */
  private foldBreakdown<
    R extends { pctSum: string | null; pctWeight: number; studentsAssessed: number },
  >(
    raw: R[],
    identity: (row: R) => { id: string; label: string; sublabel: string | null },
  ): BreakdownAggregate[] {
    const acc = new Map<string, CohortAccumulator>();
    const meta = new Map<string, { id: string; label: string; sublabel: string | null }>();
    for (const r of raw) {
      const id = identity(r);
      addCohortRow(acc, id.id, r);
      if (!meta.has(id.id)) meta.set(id.id, id);
    }
    return [...acc.entries()].map(([key, a]) => ({
      ...meta.get(key)!,
      averageAchievement: cohortAverage(a),
      studentsAssessed: a.studentsAssessed,
    }));
  }

  /**
   * Camino histórico sobre `skill_results` (grano alumno). Sólo cuando el query trae
   * `studentId` — ver `requiresPerStudentData`.
   */
  private async loadBreakdownFromSkillResults(
    tx: Database,
    orgId: string,
    scope: Scope,
    query: DashboardSkillBreakdownQueryDto,
    assessmentIds: string[],
    studentIds: string[] | null,
  ): Promise<BreakdownAggregate[]> {
    const base = [
      eq(skillResults.nodeId, query.nodeId),
      inArray(skillResults.assessmentId, assessmentIds),
    ];
    if (studentIds !== null) base.push(inArray(skillResults.studentId, studentIds));

    const avgPct = sql<string | null>`avg(${skillResults.percentage}::numeric)`;
    const studentsAssessed = sql<number>`count(distinct ${skillResults.studentId})::int`;

    if (query.groupBy === 'assessment') {
      const raw = await tx
        .select({
          id: assessments.id,
          name: assessments.name,
          instrumentName: instruments.name,
          subjectName: subjects.name,
          avgPct,
          studentsAssessed,
        })
        .from(skillResults)
        .innerJoin(assessments, eq(assessments.id, skillResults.assessmentId))
        .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
        .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
        .where(and(...base))
        .groupBy(assessments.id, assessments.name, instruments.name, subjects.name)
        .orderBy(desc(assessments.administeredAt), asc(assessments.createdAt));

      return raw.map((r) => ({
        id: r.id,
        label: r.name ?? r.instrumentName,
        sublabel: r.subjectName,
        averageAchievement: r.avgPct == null ? null : Number(r.avgPct),
        studentsAssessed: Number(r.studentsAssessed ?? 0),
      }));
    }

    if (query.groupBy === 'subject') {
      const raw = await tx
        .select({ id: subjects.id, name: subjects.name, avgPct, studentsAssessed })
        .from(skillResults)
        .innerJoin(assessments, eq(assessments.id, skillResults.assessmentId))
        .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
        .innerJoin(subjects, eq(subjects.id, instruments.subjectId))
        .where(and(...base))
        .groupBy(subjects.id, subjects.name)
        .orderBy(asc(subjects.name));

      return raw.map((r) => ({
        id: r.id,
        label: r.name,
        sublabel: null,
        averageAchievement: r.avgPct == null ? null : Number(r.avgPct),
        studentsAssessed: Number(r.studentsAssessed ?? 0),
      }));
    }

    // 'grade' | 'classGroup' — se agrupa vía la matrícula del alumno.
    // ⚠️ Multi-matrícula: un alumno en >1 curso podría contarse en varios
    // (mismo criterio best-effort que loadClassGroupByStudent). En una org/año
    // es 1:1; acotamos por año y scope para minimizarlo (F1 OK).
    const cgConditions = [eq(classGroups.orgId, orgId), ...base];
    if (!scope.scopeAll) cgConditions.push(inArray(classGroups.id, scope.classGroupIds));
    if (query.academicYearId) {
      cgConditions.push(eq(classGroups.academicYearId, query.academicYearId));
    }

    if (query.groupBy === 'grade') {
      const raw = await tx
        .select({ id: grades.id, name: grades.name, avgPct, studentsAssessed })
        .from(skillResults)
        .innerJoin(studentEnrollments, eq(studentEnrollments.studentId, skillResults.studentId))
        .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
        .innerJoin(grades, eq(grades.id, classGroups.gradeId))
        .where(and(...cgConditions))
        .groupBy(grades.id, grades.name)
        .orderBy(asc(grades.name));

      return raw.map((r) => ({
        id: r.id,
        label: r.name,
        sublabel: null,
        averageAchievement: r.avgPct == null ? null : Number(r.avgPct),
        studentsAssessed: Number(r.studentsAssessed ?? 0),
      }));
    }

    const raw = await tx
      .select({
        id: classGroups.id,
        name: classGroups.name,
        gradeName: grades.name,
        avgPct,
        studentsAssessed,
      })
      .from(skillResults)
      .innerJoin(studentEnrollments, eq(studentEnrollments.studentId, skillResults.studentId))
      .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
      .innerJoin(grades, eq(grades.id, classGroups.gradeId))
      .where(and(...cgConditions))
      .groupBy(classGroups.id, classGroups.name, grades.name)
      .orderBy(asc(classGroups.name));

    return raw.map((r) => ({
      id: r.id,
      label: r.name,
      sublabel: r.gradeName,
      averageAchievement: r.avgPct == null ? null : Number(r.avgPct),
      studentsAssessed: Number(r.studentsAssessed ?? 0),
    }));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/dashboards/teacher-kpis  (H6.8)
  // ───────────────────────────────────────────────────────────────────────────

  async getTeacherKpis(
    user: JwtPayload,
    query: DashboardFiltersQueryDto,
  ): Promise<DashboardTeacherKpisResponse> {
    const orgId = this.resolveOrgId(user);
    if (!orgId) return { courses: [] };

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await this.getAccessibleClassGroupIds(tx, user, orgId);
      if (!scope.scopeAll && scope.classGroupIds.length === 0) return { courses: [] };

      // Cursos del scope (filtrados por gradeId/classGroupId/academicYearId si vienen).
      const cgConditions = [eq(classGroups.orgId, orgId)];
      if (!scope.scopeAll) cgConditions.push(inArray(classGroups.id, scope.classGroupIds));
      if (query.classGroupId?.length)
        cgConditions.push(inArray(classGroups.id, query.classGroupId));
      if (query.gradeId?.length) cgConditions.push(inArray(classGroups.gradeId, query.gradeId));
      if (query.academicYearId) {
        cgConditions.push(eq(classGroups.academicYearId, query.academicYearId));
      }

      const courseRows = await tx
        .select({
          classGroupId: classGroups.id,
          classGroupName: classGroups.name,
          gradeName: grades.name,
        })
        .from(classGroups)
        .innerJoin(grades, eq(grades.id, classGroups.gradeId))
        .where(and(...cgConditions))
        .orderBy(classGroups.name);

      if (courseRows.length === 0) return { courses: [] };

      const courseIds = courseRows.map((r) => r.classGroupId);

      // Asignaturas por curso (puede haber varias — tomamos la lista para label).
      const subjectByCourse = await this.loadSubjectNamesByClassGroup(tx, courseIds);

      // passing_grade de la escala aplicable (default 4.0).
      const passingGrade = await this.resolvePassingGrade(tx, orgId, query);

      const assessmentIds = await this.resolveScopedAssessmentIds(tx, orgId, query);

      const courses: TeacherCourseKpiModel[] = [];
      for (const c of courseRows) {
        // Alumnos del curso (no borrados).
        const studentRows = await tx
          .select({ studentId: studentEnrollments.studentId })
          .from(studentEnrollments)
          .innerJoin(students, eq(students.id, studentEnrollments.studentId))
          .where(
            and(
              eq(studentEnrollments.classGroupId, c.classGroupId),
              eq(students.orgId, orgId),
              isNull(students.deletedAt),
            ),
          );
        const courseStudentIds = Array.from(new Set(studentRows.map((r) => r.studentId)));

        const emptyRow: TeacherCourseKpiModel = {
          classGroupId: c.classGroupId,
          classGroupName: c.classGroupName,
          gradeName: c.gradeName,
          subjectName: subjectByCourse.get(c.classGroupId) ?? null,
          instrumentId: null,
          instrumentName: null,
          studentsCount: courseStudentIds.length,
          averageAchievement: null,
          passingRate: null,
          criticalStudents: 0,
          assessmentsCount: 0,
        };

        if (courseStudentIds.length === 0 || assessmentIds.length === 0) {
          courses.push(emptyRow);
          continue;
        }

        // Una fila por INSTRUMENTO del curso: el promedio sólo tiene lectura dentro de
        // una unidad comparable (#1C). Antes se promediaba el curso entero a través de
        // todas sus evaluaciones, mezclando instrumentos de dificultad distinta.
        const aggRows = await tx
          .select({
            instrumentId: instruments.id,
            instrumentName: instruments.name,
            avgPct: sql<string | null>`avg(${assessmentResults.percentage}::numeric)`,
            assessmentsCount: sql<number>`count(distinct ${assessmentResults.assessmentId})::int`,
            totalResults: sql<number>`count(*)::int`,
            passingResults: sql<number>`count(*) filter (where ${assessmentResults.grade}::numeric >= ${passingGrade})::int`,
            criticalStudents: sql<number>`count(distinct ${assessmentResults.studentId}) filter (where ${assessmentResults.performanceLevel} = 'insufficient')::int`,
          })
          .from(assessmentResults)
          .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId))
          .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
          .where(
            and(
              inArray(assessmentResults.assessmentId, assessmentIds),
              inArray(assessmentResults.studentId, courseStudentIds),
            ),
          )
          .groupBy(instruments.id, instruments.name)
          .orderBy(instruments.name);

        if (aggRows.length === 0) {
          courses.push(emptyRow);
          continue;
        }

        for (const agg of aggRows) {
          const totalResults = Number(agg.totalResults ?? 0);
          const passingResults = Number(agg.passingResults ?? 0);
          courses.push({
            ...emptyRow,
            instrumentId: agg.instrumentId,
            instrumentName: agg.instrumentName,
            averageAchievement: agg.avgPct == null ? null : Number(agg.avgPct),
            passingRate: totalResults > 0 ? (passingResults / totalResults) * 100 : null,
            criticalStudents: Number(agg.criticalStudents ?? 0),
            assessmentsCount: Number(agg.assessmentsCount ?? 0),
          });
        }
      }

      return { courses };
    });
  }

  /**
   * Resuelve el alcance (org, cursos visibles, evaluaciones e instrumentos) para
   * `ComparableOverviewService`, que necesita exactamente el mismo scoping por rol que
   * el resto de los dashboards. Vive acá y no allá para no duplicar la resolución de
   * permisos: es la misma regla, y duplicarla es cómo se abren los agujeros de scope.
   */
  async resolveScopeForComparableOverview(
    user: JwtPayload,
    query: DashboardFiltersQueryDto,
  ): Promise<ComparableOverviewScope | null> {
    const orgId = this.resolveOrgId(user);
    if (!orgId) return null;

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await this.getAccessibleClassGroupIds(tx, user, orgId);
      const isTeacherScope = this.isTeacherScope(user);
      if (!scope.scopeAll && scope.classGroupIds.length === 0) {
        return { orgId, isTeacherScope, classGroupIds: [], assessmentIds: [], refs: [] };
      }

      const classGroupIds = await this.resolveScopedClassGroupIds(tx, orgId, scope, query);
      const scoped = await this.resolveScopedAssessments(tx, orgId, query);
      return {
        orgId,
        isTeacherScope,
        classGroupIds,
        assessmentIds: scoped.ids,
        refs: scoped.refs,
      };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers privados
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Resuelve el orgId efectivo para dashboards. NUNCA viene del query: para un
   * usuario normal es `user.orgId`. Un platform_admin sin org activa no tiene
   * contexto org → null (dashboards devuelven vacío en vez de fallar).
   */
  private resolveOrgId(user: JwtPayload): string | null {
    return user.orgId;
  }

  /** True si el caller es profesor puro (no admin-like ni platform_admin). */
  private isTeacherScope(user: JwtPayload): boolean {
    if (user.isPlatformAdmin) return false;
    return !userHasAnyRole(user.roles, ADMIN_LIKE_ROLES);
  }

  /**
   * Replica assessment-results.getAccessibleClassGroupIds: admin-like ve toda
   * la org (`scopeAll`), teacher ve sólo sus class_groups vía teacher_assignments.
   */
  private async getAccessibleClassGroupIds(
    tx: Database,
    user: JwtPayload,
    orgId: string,
  ): Promise<Scope> {
    if (user.isPlatformAdmin) return { scopeAll: true, classGroupIds: [] };

    const adminLike = userHasAnyRole(user.roles, ADMIN_LIKE_ROLES);
    if (adminLike) return { scopeAll: true, classGroupIds: [] };

    if (!userHasAnyRole(user.roles, RESULTS_VIEWER_ROLES)) {
      return { scopeAll: false, classGroupIds: [] };
    }

    const rows = await tx
      .select({ classGroupId: subjectClasses.classGroupId })
      .from(teacherAssignments)
      .innerJoin(subjectClasses, eq(subjectClasses.id, teacherAssignments.subjectClassId))
      .innerJoin(classGroups, eq(classGroups.id, subjectClasses.classGroupId))
      .where(and(eq(teacherAssignments.userId, user.userId), eq(classGroups.orgId, orgId)));

    const ids = Array.from(new Set(rows.map((r) => r.classGroupId)));
    return { scopeAll: false, classGroupIds: ids };
  }

  /**
   * Set de studentIds visibles dado el scope + filtros (classGroupId, gradeId,
   * studentId, academicYearId). Retorna `null` si scopeAll y sin filtros de
   * curso/alumno (sin filtro extra). Retorna `[]` si el filtro deja set vacío.
   */
  private async resolveScopedStudentIds(
    tx: Database,
    orgId: string,
    scope: Scope,
    query: DashboardFiltersQueryDto,
  ): Promise<string[] | null> {
    const hasStudentScopingFilter =
      !!query.classGroupId?.length ||
      !!query.gradeId?.length ||
      !!query.studentId ||
      !!query.academicYearId;

    if (scope.scopeAll && !hasStudentScopingFilter) return null;

    // Resolver el set de class_groups permitido.
    let allowedClassGroupIds: string[] | null;
    if (scope.scopeAll) {
      allowedClassGroupIds = null; // todos los de la org
    } else {
      allowedClassGroupIds = scope.classGroupIds;
      if (query.classGroupId?.length) {
        const requested = query.classGroupId.filter((id) => scope.classGroupIds.includes(id));
        if (requested.length === 0) return [];
        allowedClassGroupIds = requested;
      }
      if (allowedClassGroupIds.length === 0) return [];
    }

    const cgConditions = [eq(classGroups.orgId, orgId)];
    if (allowedClassGroupIds !== null) {
      cgConditions.push(inArray(classGroups.id, allowedClassGroupIds));
    }
    if (scope.scopeAll && query.classGroupId?.length) {
      cgConditions.push(inArray(classGroups.id, query.classGroupId));
    }
    if (query.gradeId?.length) cgConditions.push(inArray(classGroups.gradeId, query.gradeId));
    if (query.academicYearId)
      cgConditions.push(eq(classGroups.academicYearId, query.academicYearId));

    const enrollConditions = [eq(students.orgId, orgId), isNull(students.deletedAt)];
    if (query.studentId) enrollConditions.push(eq(students.id, query.studentId));

    const rows = await tx
      .select({ studentId: studentEnrollments.studentId })
      .from(studentEnrollments)
      .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
      .innerJoin(students, eq(students.id, studentEnrollments.studentId))
      .where(and(...cgConditions, ...enrollConditions));

    return Array.from(new Set(rows.map((r) => r.studentId)));
  }

  /**
   * True si el query pide algo que el read-model de cohorte no puede responder.
   *
   * Hoy es sólo `studentId`: el grano del read-model es el curso, así que acotar a un
   * alumno exige `skill_results`. No es una limitación accidental — una evaluación
   * cargada desde un informe oficial tampoco tendría ese dato.
   */
  private requiresPerStudentData(query: DashboardFiltersQueryDto): boolean {
    return !!query.studentId;
  }

  /**
   * Set de class_groups visibles dado el scope + los filtros de curso/nivel/período.
   * Es el equivalente por cohorte de `resolveScopedStudentIds`: mismo árbol de
   * decisiones, mismos filtros (menos `studentId`, ver `requiresPerStudentData`).
   *
   * Retorna `null` si el caller ve toda la org y no hay filtro que acote (sin
   * restricción), `[]` si el filtro deja el set vacío.
   */
  private async resolveScopedClassGroupIds(
    tx: Database,
    orgId: string,
    scope: Scope,
    query: DashboardFiltersQueryDto,
  ): Promise<string[] | null> {
    const hasScopingFilter =
      !!query.classGroupId?.length || !!query.gradeId?.length || !!query.academicYearId;

    if (scope.scopeAll && !hasScopingFilter) return null;

    let allowedClassGroupIds: string[] | null;
    if (scope.scopeAll) {
      allowedClassGroupIds = null; // todos los de la org
    } else {
      allowedClassGroupIds = scope.classGroupIds;
      if (query.classGroupId?.length) {
        const requested = query.classGroupId.filter((id) => scope.classGroupIds.includes(id));
        if (requested.length === 0) return [];
        allowedClassGroupIds = requested;
      }
      if (allowedClassGroupIds.length === 0) return [];
    }

    const cgConditions = [eq(classGroups.orgId, orgId)];
    if (allowedClassGroupIds !== null) {
      cgConditions.push(inArray(classGroups.id, allowedClassGroupIds));
    }
    if (scope.scopeAll && query.classGroupId?.length) {
      cgConditions.push(inArray(classGroups.id, query.classGroupId));
    }
    if (query.gradeId?.length) cgConditions.push(inArray(classGroups.gradeId, query.gradeId));
    if (query.academicYearId) {
      cgConditions.push(eq(classGroups.academicYearId, query.academicYearId));
    }

    const rows = await tx
      .select({ id: classGroups.id })
      .from(classGroups)
      .where(and(...cgConditions));

    return Array.from(new Set(rows.map((r) => r.id)));
  }

  /**
   * Conjunto de assessmentIds de la org que matchean los filtros de
   * instrumento/asignatura/grado/evaluación. Siempre acotado a la org.
   */
  private async resolveScopedAssessmentIds(
    tx: Database,
    orgId: string,
    query: DashboardFiltersQueryDto,
  ): Promise<string[]> {
    return (await this.resolveScopedAssessments(tx, orgId, query)).ids;
  }

  /**
   * Evaluaciones del alcance filtrado JUNTO CON los instrumentos distintos que
   * participan de él. Van juntos a propósito: la comparabilidad se deriva de los
   * mismos instrumentos que esta query ya joinea, así que resolverla no cuesta un
   * viaje extra a la base.
   */
  private async resolveScopedAssessments(
    tx: Database,
    orgId: string,
    query: DashboardFiltersQueryDto,
  ): Promise<ScopedAssessments> {
    const conditions = [eq(assessments.orgId, orgId), isNull(instruments.deletedAt)];
    if (query.assessmentId) conditions.push(eq(assessments.id, query.assessmentId));
    if (query.instrumentId) conditions.push(eq(assessments.instrumentId, query.instrumentId));
    if (query.instrumentType?.length) {
      conditions.push(inArray(sql`${instruments.type}::text`, query.instrumentType));
    }
    if (query.subjectId?.length) conditions.push(inArray(instruments.subjectId, query.subjectId));
    if (query.gradeId?.length) conditions.push(inArray(instruments.gradeId, query.gradeId));
    if (query.applicationPeriod?.length) {
      conditions.push(
        inArray(sql`${instruments.applicationPeriod}::text`, query.applicationPeriod),
      );
    }

    const rows = await tx
      .select({
        id: assessments.id,
        instrumentId: instruments.id,
        instrumentType: instruments.type,
        instrumentSubjectId: instruments.subjectId,
        instrumentGradeId: instruments.gradeId,
        instrumentApplicationPeriod: instruments.applicationPeriod,
        instrumentYear: instruments.year,
      })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .where(and(...conditions));

    const ids = new Set<string>();
    const byInstrument = new Map<string, ComparabilityInstrumentRef>();
    for (const row of rows) {
      ids.add(row.id);
      if (row.instrumentId == null || byInstrument.has(row.instrumentId)) continue;
      byInstrument.set(row.instrumentId, {
        instrumentId: row.instrumentId,
        type: row.instrumentType,
        subjectId: row.instrumentSubjectId,
        gradeId: row.instrumentGradeId,
        applicationPeriod: row.instrumentApplicationPeriod,
        year: row.instrumentYear,
      });
    }
    return { ids: Array.from(ids), refs: Array.from(byInstrument.values()) };
  }

  /**
   * Bandas de logro aplicables SÓLO cuando el scope resuelve a un ÚNICO
   * instrumento con bandas configuradas (ej. mirar una evaluación DIA). Con
   * varios instrumentos en scope, un corte por-instrumento no está bien definido
   * (limitación multi-escala, F2) → devuelve null y se usa el corte legacy.
   * Corre dentro de withOrgContext → RLS trae globales (org_id NULL) + override org.
   */
  private async resolveScopedBands(
    tx: Database,
    query: DashboardFiltersQueryDto,
    assessmentIds: string[],
  ): Promise<PerformanceBandInput[] | null> {
    let instrumentId = query.instrumentId ?? null;
    if (!instrumentId) {
      if (assessmentIds.length === 0) return null;
      const rows = await tx
        .selectDistinct({ instrumentId: assessments.instrumentId })
        .from(assessments)
        .where(inArray(assessments.id, assessmentIds));
      if (rows.length !== 1) return null; // 0 o múltiples instrumentos → sin bandas
      instrumentId = rows[0]!.instrumentId;
    }
    const bands = await loadInstrumentBands(tx, instrumentId);
    return bands.length > 0 ? bands : null;
  }

  private buildResultConditions(
    assessmentIds: string[],
    studentIds: string[] | null,
    performanceLevel: PerformanceLevel | undefined,
  ) {
    const conditions = [inArray(assessmentResults.assessmentId, assessmentIds)];
    if (studentIds !== null) conditions.push(inArray(assessmentResults.studentId, studentIds));
    if (performanceLevel) conditions.push(eq(assessmentResults.performanceLevel, performanceLevel));
    return conditions;
  }

  /**
   * Distribución por nivel de desempeño contando cada (alumno, assessment) como
   * un punto. Agregado en SQL con group by.
   */
  private async computePerformanceDistribution(
    tx: Database,
    assessmentIds: string[],
    studentIds: string[] | null,
  ): Promise<PerformanceDistributionBucket[]> {
    if (assessmentIds.length === 0) return this.emptyDistribution();

    const conditions = this.buildResultConditions(assessmentIds, studentIds, undefined);
    const rows = await tx
      .select({
        level: assessmentResults.performanceLevel,
        count: sql<number>`count(*)::int`,
      })
      .from(assessmentResults)
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .where(and(...conditions, isNull(students.deletedAt)))
      .groupBy(assessmentResults.performanceLevel);

    const countByLevel = new Map<string, number>();
    let total = 0;
    for (const r of rows) {
      if (!r.level) continue; // ignoramos resultados sin nivel asignado
      const c = Number(r.count ?? 0);
      countByLevel.set(r.level, c);
      total += c;
    }

    return PERFORMANCE_LEVELS.map((level) => {
      const count = countByLevel.get(level) ?? 0;
      return {
        level,
        count,
        percentage: total > 0 ? (count / total) * 100 : 0,
      };
    });
  }

  private emptyDistribution(): PerformanceDistributionBucket[] {
    return PERFORMANCE_LEVELS.map((level) => ({ level, count: 0, percentage: 0 }));
  }

  /**
   * Evaluaciones del scope (TODAS, ordenadas de la más reciente a la más antigua),
   * con su nombre de instrumento, asignatura, grado, conteo de alumnos y % logro.
   *
   * No se truncan: una lista recortada no puede explicar el KPI global, que agrega
   * sobre el scope completo — y comparar "% Logro" contra las filas visibles daba
   * una discrepancia que parecía un error de cálculo. El recorte a 5 se quitó por
   * eso; si el volumen molesta, la salida correcta es paginar, no esconder filas.
   */
  private async loadRecentAssessments(
    tx: Database,
    orgId: string,
    scope: Scope,
    query: DashboardFiltersQueryDto,
    studentIds: string[] | null,
  ): Promise<{ data: DashboardAssessmentSummary[]; total: number }> {
    const assessmentIds = await this.resolveScopedAssessmentIds(tx, orgId, query);
    if (assessmentIds.length === 0) return EMPTY_RECENT_ASSESSMENTS;

    // Teacher scoping: si el caller está acotado a un set de alumnos
    // (studentIds !== null), las evaluaciones recientes deben intersectarse con
    // las que tienen resultados de esos alumnos. Si no, un profesor vería en la
    // lista nombres de evaluaciones de toda la org que no tocan a sus cursos.
    let scopedAssessmentIds = assessmentIds;
    if (studentIds !== null) {
      if (studentIds.length === 0) return EMPTY_RECENT_ASSESSMENTS;
      const withResults = await tx
        .selectDistinct({ assessmentId: assessmentResults.assessmentId })
        .from(assessmentResults)
        .where(
          and(
            inArray(assessmentResults.assessmentId, assessmentIds),
            inArray(assessmentResults.studentId, studentIds),
          ),
        );
      // Una evaluación `aggregate_only` no tiene filas por alumno, así que la
      // intersección per-alumno la dejaría fuera de la lista del profesor aunque sea
      // de sus cursos. Su equivalente de cohorte es tener read-model para alguno de
      // esos cursos.
      const withCohort = await loadCohortAchievementByAssessment(
        tx,
        assessmentIds,
        scope.classGroupIds,
      );
      scopedAssessmentIds = [
        ...new Set([
          ...withResults.map((r) => r.assessmentId),
          ...withCohort.map((r) => r.assessmentId),
        ]),
      ];
      if (scopedAssessmentIds.length === 0) return EMPTY_RECENT_ASSESSMENTS;
    }

    const rows = await tx
      .select({
        assessmentId: assessments.id,
        name: assessments.name,
        administeredAt: assessments.administeredAt,
        createdAt: assessments.createdAt,
        status: assessments.status,
        instrumentName: instruments.name,
        instrumentType: instruments.type,
        subjectName: subjects.name,
        gradeName: grades.name,
      })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
      .leftJoin(grades, eq(grades.id, instruments.gradeId))
      .where(inArray(assessments.id, scopedAssessmentIds))
      .orderBy(desc(assessments.administeredAt), desc(assessments.createdAt));

    if (rows.length === 0) return EMPTY_RECENT_ASSESSMENTS;

    const summaryAssessmentIds = rows.map((r) => r.assessmentId);
    const statsConditions = [inArray(assessmentResults.assessmentId, summaryAssessmentIds)];
    if (studentIds !== null) statsConditions.push(inArray(assessmentResults.studentId, studentIds));

    const statsRows = await tx
      .select({
        assessmentId: assessmentResults.assessmentId,
        studentsCount: sql<number>`count(distinct ${assessmentResults.studentId})::int`,
        avgPct: sql<string | null>`avg(${assessmentResults.percentage}::numeric)`,
      })
      .from(assessmentResults)
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .where(and(...statsConditions, isNull(students.deletedAt)))
      .groupBy(assessmentResults.assessmentId);

    const statsByAssessment = new Map<string, { studentsCount: number; avgPct: number | null }>();
    for (const s of statsRows) {
      statsByAssessment.set(s.assessmentId, {
        studentsCount: Number(s.studentsCount ?? 0),
        avgPct: s.avgPct == null ? null : Number(s.avgPct),
      });
    }

    // Fallback de cohorte para las evaluaciones sin filas por alumno (informes
    // oficiales cargados en modo agregado): sin esto la tarjeta muestra "0 alumnos"
    // y logro "—" teniendo el dato en el read-model. Misma definición de N que usan
    // el hub de la evaluación y `getOverview`.
    const cohortStats = await loadCohortAchievementByAssessment(
      tx,
      summaryAssessmentIds,
      scope.scopeAll ? null : scope.classGroupIds,
    );
    const cohortByAssessment = new Map(cohortStats.map((c) => [c.assessmentId, c]));

    const data = rows.map((r) => {
      const cohort = cohortByAssessment.get(r.assessmentId);
      const perStudent = statsByAssessment.get(r.assessmentId);
      // ⚠️ El fallback es CAMPO A CAMPO, no todo-o-nada. Un informe oficial cargado
      // en modo agregado puede tener filas por alumno que sólo traen el nivel de
      // desempeño (`performance_band_id`) con `percentage` NULL: existían filas, así
      // que el fallback todo-o-nada se daba por satisfecho y la evaluación mostraba
      // logro "—" teniendo el dato en el read-model de cohorte.
      const stats = {
        studentsCount: perStudent?.studentsCount || (cohort?.studentsAssessed ?? 0),
        avgPct: perStudent?.avgPct ?? cohort?.averageAchievement ?? null,
      };
      return {
        assessmentId: r.assessmentId,
        name: r.name,
        instrumentName: r.instrumentName,
        instrumentType: r.instrumentType,
        subjectName: r.subjectName,
        gradeName: r.gradeName,
        administeredAt: r.administeredAt,
        studentsCount: stats?.studentsCount ?? 0,
        averageAchievement: stats?.avgPct ?? null,
        status: r.status as AssessmentStatus,
      };
    });

    return { data, total: scopedAssessmentIds.length };
  }

  /**
   * Deriva alertas: cursos con % logro < 60 (low_achievement) y habilidades con
   * promedio < 50 (critical_skill). Sobre el scope filtrado.
   */
  /** Períodos = academic_years de la org, año desc. */
  /**
   * Año académico al que se acota el CATÁLOGO de cursos de `/dashboards/filters`.
   *
   * Precedencia: (1) el año pedido explícitamente; (2) el año vigente, si tiene
   * cursos visibles; (3) el año más reciente que sí los tenga. Devuelve `null`
   * cuando el scope no ve ningún curso (no hay nada que acotar).
   *
   * El fallback (3) existe porque un año vigente recién abierto todavía no tiene
   * cursos cargados: sin él, el catálogo saldría vacío y las vistas de resultados
   * quedarían en blanco pese a haber datos del año anterior.
   */
  private async resolveCatalogAcademicYear(
    tx: Database,
    orgId: string,
    requested: string | undefined,
    cgConditions: SQL[],
  ): Promise<string | null> {
    if (requested) return requested;

    // Años que efectivamente tienen cursos visibles para este scope.
    const yearsWithGroups = await tx
      .selectDistinct({
        academicYearId: classGroups.academicYearId,
        year: academicYears.year,
        isCurrent: academicYears.isCurrent,
      })
      .from(classGroups)
      .innerJoin(academicYears, eq(academicYears.id, classGroups.academicYearId))
      .where(and(...cgConditions))
      .orderBy(desc(academicYears.year));

    if (yearsWithGroups.length === 0) return null;
    const current = yearsWithGroups.find((y) => y.isCurrent);
    return (current ?? yearsWithGroups[0]).academicYearId;
  }

  private async loadPeriods(orgId: string) {
    const rows = await this.db
      .select({
        id: academicYears.id,
        year: academicYears.year,
        isCurrent: academicYears.isCurrent,
      })
      .from(academicYears)
      .where(eq(academicYears.orgId, orgId))
      .orderBy(desc(academicYears.year));

    return rows.map((r) => ({
      id: r.id,
      year: r.year,
      label: String(r.year),
      isCurrent: r.isCurrent,
    }));
  }

  /**
   * Mapa studentId → { id, name } de su class_group visible. Si el alumno está
   * en varios cursos visibles, tomamos el primero por nombre.
   */
  private async loadClassGroupByStudent(
    tx: Database,
    orgId: string,
    scope: Scope,
    studentIds: string[],
  ): Promise<Map<string, { id: string; name: string }>> {
    const map = new Map<string, { id: string; name: string }>();
    if (studentIds.length === 0) return map;

    const conditions = [
      eq(classGroups.orgId, orgId),
      inArray(studentEnrollments.studentId, studentIds),
    ];
    if (!scope.scopeAll) conditions.push(inArray(classGroups.id, scope.classGroupIds));

    const rows = await tx
      .select({
        studentId: studentEnrollments.studentId,
        classGroupId: classGroups.id,
        classGroupName: classGroups.name,
      })
      .from(studentEnrollments)
      .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
      .where(and(...conditions))
      .orderBy(classGroups.name);

    for (const r of rows) {
      if (!map.has(r.studentId)) {
        map.set(r.studentId, { id: r.classGroupId, name: r.classGroupName });
      }
    }
    return map;
  }

  /** Mapa classGroupId → nombres de asignaturas (join por ", "). */
  private async loadSubjectNamesByClassGroup(
    tx: Database,
    classGroupIds: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (classGroupIds.length === 0) return map;

    const rows = await tx
      .select({
        classGroupId: subjectClasses.classGroupId,
        subjectName: subjects.name,
      })
      .from(subjectClasses)
      .innerJoin(subjects, eq(subjects.id, subjectClasses.subjectId))
      .where(inArray(subjectClasses.classGroupId, classGroupIds))
      .orderBy(subjects.name);

    const byGroup = new Map<string, string[]>();
    for (const r of rows) {
      const list = byGroup.get(r.classGroupId) ?? [];
      if (!list.includes(r.subjectName)) list.push(r.subjectName);
      byGroup.set(r.classGroupId, list);
    }
    for (const [cg, names] of byGroup) map.set(cg, names.join(', '));
    return map;
  }

  /**
   * Umbrales (0..1) de la grading scale aplicable. Si las evaluaciones del scope
   * comparten un instrumento con grading_scale que define
   * config.performanceThresholds, se usa esa; si no, defaults 0.4/0.7/0.85.
   */
  private async resolveThresholds(
    tx: Database,
    orgId: string,
    query: DashboardFiltersQueryDto,
    assessmentIds: string[],
  ): Promise<{ elementary: number; adequate: number; advanced: number }> {
    const defaults = {
      elementary: DEFAULT_THRESHOLDS.elementary,
      adequate: DEFAULT_THRESHOLDS.adequate,
      advanced: DEFAULT_THRESHOLDS.advanced,
    };

    const scale = await this.resolveApplicableScale(tx, orgId, query, assessmentIds);
    const cfg = scale?.config as
      | { performanceThresholds?: { elementary?: number; adequate?: number; advanced?: number } }
      | null
      | undefined;
    const t = cfg?.performanceThresholds;
    if (!t) return defaults;
    return {
      elementary: t.elementary ?? defaults.elementary,
      adequate: t.adequate ?? defaults.adequate,
      advanced: t.advanced ?? defaults.advanced,
    };
  }

  /** passing_grade (número) de la escala aplicable, default 4.0. */
  private async resolvePassingGrade(
    tx: Database,
    orgId: string,
    query: DashboardFiltersQueryDto,
  ): Promise<number> {
    const assessmentIds = await this.resolveScopedAssessmentIds(tx, orgId, query);
    const scale = await this.resolveApplicableScale(tx, orgId, query, assessmentIds);
    return scale ? Number(scale.passingGrade) : 4;
  }

  /**
   * Grading scale aplicable: la del instrumento de la primera evaluación del
   * scope que tenga una asignada. Retorna null si ninguna define escala.
   *
   * ⚠️ LIMITACIÓN (F1 OK / revisar en F2): asume escala HOMOGÉNEA en el scope.
   * Con un scope que mezcle instrumentos de escalas distintas, toma una sola
   * (`limit(1)`) y la aplica a todo el dashboard. En F1 (solo DIA) no afecta. El
   * fix real (escala por instrumento) se difiere a F2 multi-escala; el
   * `orderBy(createdAt)` solo hace determinista cuál escala se elige.
   */
  private async resolveApplicableScale(
    tx: Database,
    orgId: string,
    query: DashboardFiltersQueryDto,
    assessmentIds: string[],
  ): Promise<{ passingGrade: string; config: Record<string, unknown> | null } | null> {
    if (assessmentIds.length === 0) return null;

    const [row] = await tx
      .select({
        passingGrade: gradingScales.passingGrade,
        config: gradingScales.config,
      })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .innerJoin(gradingScales, eq(gradingScales.id, instruments.gradingScaleId))
      .where(and(eq(assessments.orgId, orgId), inArray(assessments.id, assessmentIds)))
      // Determinista: instrumento más antiguo del scope, no una fila arbitraria.
      .orderBy(asc(instruments.createdAt))
      .limit(1);

    return row ?? null;
  }
}
