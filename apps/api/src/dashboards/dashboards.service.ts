import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import {
  academicYears,
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
  classifyByBands,
  percentageToPerformanceLevel,
  userHasAnyRole,
  type AssessmentStatus,
  type DashboardAlert,
  type DashboardAssessmentSummary,
  type DashboardFilterOptionsResponse,
  type DashboardFiltersQueryDto,
  type DashboardOverviewResponse,
  type DashboardPerformanceQueryDto,
  type DashboardPerformanceResponse,
  type DashboardSkillBreakdownQueryDto,
  type DashboardSkillBreakdownResponse,
  type DashboardSkillsResponse,
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
      globalAchievement: null,
      studentsEvaluated: 0,
      assessmentsCount: 0,
      performanceDistribution: this.emptyDistribution(),
      recentAssessments: [],
      alerts: [],
    };
    if (!orgId) return empty;

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await this.getAccessibleClassGroupIds(tx, user, orgId);
      if (!scope.scopeAll && scope.classGroupIds.length === 0) return empty;

      const studentIds = await this.resolveScopedStudentIds(tx, orgId, scope, query);
      if (studentIds !== null && studentIds.length === 0) return empty;

      const assessmentIds = await this.resolveScopedAssessmentIds(tx, orgId, query);
      if (assessmentIds.length === 0) {
        return { ...empty, scope: isTeacherScope ? 'teacher' : 'org' };
      }

      const resultConditions = this.buildResultConditions(assessmentIds, studentIds, undefined);

      // ── Parte per-alumno (`assessment_results`) — informes item_level ──────────
      // Promedio de % logro y alumnos distintos evaluados.
      const [metrics] = await tx
        .select({
          avgPct: sql<string | null>`avg(${assessmentResults.percentage}::numeric)`,
          studentsEvaluated: sql<number>`count(distinct ${assessmentResults.studentId})::int`,
        })
        .from(assessmentResults)
        .innerJoin(students, eq(students.id, assessmentResults.studentId))
        .where(and(...resultConditions, isNull(students.deletedAt)));

      // AssessmentIds que SÍ tienen datos per-alumno en el scope. Se usa para no
      // doble-contar contra el read-model de cohorte (un assessment computed escribe
      // en ambos): sus alumnos ya salen del `count(distinct)` de arriba.
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

      const pctResults = metrics?.avgPct == null ? null : Number(metrics.avgPct);
      const nResults = Number(metrics?.studentsEvaluated ?? 0);

      // Acumula SÓLO los assessment agregados (los que no aparecen en
      // `assessment_results`) para no doble-contar los computed.
      const cohortAssessmentIds = new Set<string>();
      let cohortStudents = 0; // Σ N_curso de los agregados (para studentsEvaluated)
      let cohortAchNum = 0; //   Σ (logro_a × N_a) de los agregados con logro no nulo
      let cohortAchWeight = 0; // Σ N_a de esos mismos agregados
      for (const c of cohortByAssessment) {
        cohortAssessmentIds.add(c.assessmentId);
        if (resultAssessmentIds.has(c.assessmentId)) continue; // ya contado per-alumno
        cohortStudents += c.studentsAssessed;
        if (c.averageAchievement != null) {
          cohortAchNum += c.averageAchievement * c.studentsAssessed;
          cohortAchWeight += c.studentsAssessed;
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

      // globalAchievement = mezcla ponderada por N de ambas fuentes:
      //   (pct_results × N_results + Σ logro_a × N_a) / (N_results + Σ N_a)
      // Si una parte no tiene datos (null / peso 0) se pondera sólo la otra; si ninguna,
      // el resultado es null (mismo contrato nullable de antes).
      let achNum = 0;
      let achWeight = 0;
      if (pctResults != null && nResults > 0) {
        achNum += pctResults * nResults;
        achWeight += nResults;
      }
      achNum += cohortAchNum;
      achWeight += cohortAchWeight;
      const globalAchievement = achWeight > 0 ? achNum / achWeight : null;

      const distribution = await this.computePerformanceDistribution(tx, assessmentIds, studentIds);

      const recentAssessments = await this.loadRecentAssessments(
        tx,
        orgId,
        scope,
        query,
        studentIds,
      );

      const alerts = await this.deriveAlerts(tx, orgId, scope, query, studentIds, assessmentIds);

      return {
        scope: isTeacherScope ? 'teacher' : 'org',
        globalAchievement,
        studentsEvaluated,
        assessmentsCount,
        performanceDistribution: distribution,
        recentAssessments,
        alerts,
      };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/dashboards/filters  (H6.2)
  // ───────────────────────────────────────────────────────────────────────────

  async getFilterOptions(
    user: JwtPayload,
    _query: DashboardFiltersQueryDto,
  ): Promise<DashboardFilterOptionsResponse> {
    const orgId = this.resolveOrgId(user);
    const empty: DashboardFilterOptionsResponse = {
      subjects: [],
      grades: [],
      classGroups: [],
      periods: [],
      instruments: [],
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

      return {
        subjects: subjectRows.map((r) => ({ id: r.id, label: r.name })),
        grades: Array.from(gradeMap.entries()).map(([id, label]) => ({ id, label })),
        classGroups: classGroupRows.map((r) => ({
          id: r.id,
          label: r.name,
          gradeId: r.gradeId,
          academicYearId: r.academicYearId,
        })),
        periods,
        instruments: instrumentRows.map((r) => ({
          id: r.id,
          label: r.name,
          type: r.type,
          subjectId: r.subjectId,
          gradeId: r.gradeId,
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
      distribution: this.emptyDistribution(),
      thresholds,
      students: { data: [], total: 0, page: query.page, limit: query.limit },
    };
    if (!orgId) return empty;

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await this.getAccessibleClassGroupIds(tx, user, orgId);
      if (!scope.scopeAll && scope.classGroupIds.length === 0) return empty;

      const studentIds = await this.resolveScopedStudentIds(tx, orgId, scope, query);
      if (studentIds !== null && studentIds.length === 0) return empty;

      const assessmentIds = await this.resolveScopedAssessmentIds(tx, orgId, query);
      if (assessmentIds.length === 0) {
        return {
          ...empty,
          thresholds: await this.resolveThresholds(tx, orgId, query, assessmentIds),
        };
      }

      const resolvedThresholds = await this.resolveThresholds(tx, orgId, query, assessmentIds);

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
      const bands = await this.resolveScopedBands(tx, query, assessmentIds);

      let classified: StudentClassificationModel[] = aggregateRows.map((r) => {
        const pct = r.avgPct == null ? null : Number(r.avgPct);
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
      const distribution: PerformanceDistributionBucket[] = PERFORMANCE_LEVELS.map((level) => {
        const count = classified.filter((c) => c.performanceLevel === level).length;
        return {
          level,
          count,
          percentage: classifiedTotal > 0 ? (count / classifiedTotal) * 100 : 0,
        };
      });

      // Distribución por banda del instrumento (N niveles reales) cuando aplica.
      let bandDistribution: PerformanceBandDistributionBucket[] | undefined;
      if (bands) {
        const withBand = classified.filter((c) => c.performanceBand != null).length;
        bandDistribution = bands.map((b) => {
          const count = classified.filter((c) => c.performanceBand?.key === b.key).length;
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
    if (!orgId) return { skills: [] };

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await this.getAccessibleClassGroupIds(tx, user, orgId);
      if (!scope.scopeAll && scope.classGroupIds.length === 0) return { skills: [] };

      const perStudent = this.requiresPerStudentData(query);
      const studentIds = perStudent
        ? await this.resolveScopedStudentIds(tx, orgId, scope, query)
        : null;
      if (studentIds !== null && studentIds.length === 0) return { skills: [] };

      const classGroupIds = perStudent
        ? null
        : await this.resolveScopedClassGroupIds(tx, orgId, scope, query);
      if (classGroupIds !== null && classGroupIds.length === 0) return { skills: [] };

      const assessmentIds = await this.resolveScopedAssessmentIds(tx, orgId, query);
      if (assessmentIds.length === 0) return { skills: [] };

      // Thresholds de la escala aplicable (consistente con getPerformance/
      // getDistribution; antes getSkills usaba siempre defaults). Misma limitación
      // multi-escala documentada en resolveApplicableScale (F1 OK / revisar en F2).
      const resolvedThresholds = await this.resolveThresholds(tx, orgId, query, assessmentIds);
      const scaleThresholds = {
        elementary: resolvedThresholds.elementary,
        adequate: resolvedThresholds.adequate,
        advanced: resolvedThresholds.advanced,
      };

      const bands = await this.resolveScopedBands(tx, query, assessmentIds);

      const aggregates = perStudent
        ? await this.loadSkillsFromSkillResults(tx, assessmentIds, studentIds)
        : await this.loadSkillsFromCohortStats(tx, assessmentIds, classGroupIds);

      const skills: SkillAchievementModel[] = aggregates.map((a) => {
        const pct = a.averageAchievement;
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

      return bands ? { skills, bands: bands.map(toBandView) } : { skills };
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
      if (query.classGroupId) cgConditions.push(eq(classGroups.id, query.classGroupId));
      if (query.gradeId) cgConditions.push(eq(classGroups.gradeId, query.gradeId));
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

        if (courseStudentIds.length === 0 || assessmentIds.length === 0) {
          courses.push({
            classGroupId: c.classGroupId,
            classGroupName: c.classGroupName,
            gradeName: c.gradeName,
            subjectName: subjectByCourse.get(c.classGroupId) ?? null,
            studentsCount: courseStudentIds.length,
            averageAchievement: null,
            passingRate: null,
            criticalStudents: 0,
            assessmentsCount: 0,
          });
          continue;
        }

        const [agg] = await tx
          .select({
            avgPct: sql<string | null>`avg(${assessmentResults.percentage}::numeric)`,
            assessmentsCount: sql<number>`count(distinct ${assessmentResults.assessmentId})::int`,
            totalResults: sql<number>`count(*)::int`,
            passingResults: sql<number>`count(*) filter (where ${assessmentResults.grade}::numeric >= ${passingGrade})::int`,
            criticalStudents: sql<number>`count(distinct ${assessmentResults.studentId}) filter (where ${assessmentResults.performanceLevel} = 'insufficient')::int`,
          })
          .from(assessmentResults)
          .where(
            and(
              inArray(assessmentResults.assessmentId, assessmentIds),
              inArray(assessmentResults.studentId, courseStudentIds),
            ),
          );

        const avgPct = agg?.avgPct == null ? null : Number(agg.avgPct);
        const totalResults = Number(agg?.totalResults ?? 0);
        const passingResults = Number(agg?.passingResults ?? 0);
        const passingRate = totalResults > 0 ? (passingResults / totalResults) * 100 : null;

        courses.push({
          classGroupId: c.classGroupId,
          classGroupName: c.classGroupName,
          gradeName: c.gradeName,
          subjectName: subjectByCourse.get(c.classGroupId) ?? null,
          studentsCount: courseStudentIds.length,
          averageAchievement: avgPct,
          passingRate,
          criticalStudents: Number(agg?.criticalStudents ?? 0),
          assessmentsCount: Number(agg?.assessmentsCount ?? 0),
        });
      }

      return { courses };
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
      !!query.classGroupId || !!query.gradeId || !!query.studentId || !!query.academicYearId;

    if (scope.scopeAll && !hasStudentScopingFilter) return null;

    // Resolver el set de class_groups permitido.
    let allowedClassGroupIds: string[] | null;
    if (scope.scopeAll) {
      allowedClassGroupIds = null; // todos los de la org
    } else {
      allowedClassGroupIds = scope.classGroupIds;
      if (query.classGroupId) {
        if (!scope.classGroupIds.includes(query.classGroupId)) return [];
        allowedClassGroupIds = [query.classGroupId];
      }
      if (allowedClassGroupIds.length === 0) return [];
    }

    const cgConditions = [eq(classGroups.orgId, orgId)];
    if (allowedClassGroupIds !== null) {
      cgConditions.push(inArray(classGroups.id, allowedClassGroupIds));
    }
    if (scope.scopeAll && query.classGroupId) {
      cgConditions.push(eq(classGroups.id, query.classGroupId));
    }
    if (query.gradeId) cgConditions.push(eq(classGroups.gradeId, query.gradeId));
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
    const hasScopingFilter = !!query.classGroupId || !!query.gradeId || !!query.academicYearId;

    if (scope.scopeAll && !hasScopingFilter) return null;

    let allowedClassGroupIds: string[] | null;
    if (scope.scopeAll) {
      allowedClassGroupIds = null; // todos los de la org
    } else {
      allowedClassGroupIds = scope.classGroupIds;
      if (query.classGroupId) {
        if (!scope.classGroupIds.includes(query.classGroupId)) return [];
        allowedClassGroupIds = [query.classGroupId];
      }
      if (allowedClassGroupIds.length === 0) return [];
    }

    const cgConditions = [eq(classGroups.orgId, orgId)];
    if (allowedClassGroupIds !== null) {
      cgConditions.push(inArray(classGroups.id, allowedClassGroupIds));
    }
    if (scope.scopeAll && query.classGroupId) {
      cgConditions.push(eq(classGroups.id, query.classGroupId));
    }
    if (query.gradeId) cgConditions.push(eq(classGroups.gradeId, query.gradeId));
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
    const conditions = [eq(assessments.orgId, orgId), isNull(instruments.deletedAt)];
    if (query.assessmentId) conditions.push(eq(assessments.id, query.assessmentId));
    if (query.instrumentId) conditions.push(eq(assessments.instrumentId, query.instrumentId));
    if (query.instrumentType) {
      conditions.push(sql`${instruments.type}::text = ${query.instrumentType}`);
    }
    if (query.subjectId) conditions.push(eq(instruments.subjectId, query.subjectId));
    if (query.gradeId) conditions.push(eq(instruments.gradeId, query.gradeId));

    const rows = await tx
      .select({ id: assessments.id })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .where(and(...conditions));

    return Array.from(new Set(rows.map((r) => r.id)));
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
   * Últimas evaluaciones (máx 5) del scope, con su nombre de instrumento,
   * asignatura, grado, conteo de alumnos y % logro promedio.
   */
  private async loadRecentAssessments(
    tx: Database,
    orgId: string,
    scope: Scope,
    query: DashboardFiltersQueryDto,
    studentIds: string[] | null,
  ): Promise<DashboardAssessmentSummary[]> {
    const assessmentIds = await this.resolveScopedAssessmentIds(tx, orgId, query);
    if (assessmentIds.length === 0) return [];

    // Teacher scoping: si el caller está acotado a un set de alumnos
    // (studentIds !== null), las evaluaciones recientes deben intersectarse con
    // las que tienen resultados de esos alumnos. Si no, un profesor vería en la
    // lista nombres de evaluaciones de toda la org que no tocan a sus cursos.
    let scopedAssessmentIds = assessmentIds;
    if (studentIds !== null) {
      if (studentIds.length === 0) return [];
      const withResults = await tx
        .selectDistinct({ assessmentId: assessmentResults.assessmentId })
        .from(assessmentResults)
        .where(
          and(
            inArray(assessmentResults.assessmentId, assessmentIds),
            inArray(assessmentResults.studentId, studentIds),
          ),
        );
      scopedAssessmentIds = withResults.map((r) => r.assessmentId);
      if (scopedAssessmentIds.length === 0) return [];
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
      .orderBy(desc(assessments.administeredAt), desc(assessments.createdAt))
      .limit(5);

    if (rows.length === 0) return [];

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

    void scope;

    return rows.map((r) => {
      const stats = statsByAssessment.get(r.assessmentId);
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
  }

  /**
   * Deriva alertas: cursos con % logro < 60 (low_achievement) y habilidades con
   * promedio < 50 (critical_skill). Sobre el scope filtrado.
   */
  private async deriveAlerts(
    tx: Database,
    orgId: string,
    scope: Scope,
    query: DashboardFiltersQueryDto,
    studentIds: string[] | null,
    assessmentIds: string[],
  ): Promise<DashboardAlert[]> {
    const alerts: DashboardAlert[] = [];
    if (assessmentIds.length === 0) return alerts;

    // 1) Cursos con bajo logro (< 60% promedio).
    const cgConditions = [eq(classGroups.orgId, orgId)];
    if (!scope.scopeAll) cgConditions.push(inArray(classGroups.id, scope.classGroupIds));
    if (query.classGroupId) cgConditions.push(eq(classGroups.id, query.classGroupId));
    if (query.gradeId) cgConditions.push(eq(classGroups.gradeId, query.gradeId));
    if (query.academicYearId)
      cgConditions.push(eq(classGroups.academicYearId, query.academicYearId));

    const resultConditions = [inArray(assessmentResults.assessmentId, assessmentIds)];
    if (studentIds !== null) {
      resultConditions.push(inArray(assessmentResults.studentId, studentIds));
    }

    const courseAchievementRows = await tx
      .select({
        classGroupId: classGroups.id,
        classGroupName: classGroups.name,
        avgPct: sql<string | null>`avg(${assessmentResults.percentage}::numeric)`,
      })
      .from(assessmentResults)
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .innerJoin(studentEnrollments, eq(studentEnrollments.studentId, assessmentResults.studentId))
      .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
      .where(and(...resultConditions, ...cgConditions, isNull(students.deletedAt)))
      .groupBy(classGroups.id, classGroups.name);

    for (const r of courseAchievementRows) {
      const pct = r.avgPct == null ? null : Number(r.avgPct);
      if (pct != null && pct < 60) {
        alerts.push({
          type: 'low_achievement',
          severity: pct < 40 ? 'high' : 'medium',
          message: `El curso ${r.classGroupName} tiene un logro promedio de ${pct.toFixed(1)}%`,
          contextId: r.classGroupId,
          contextLabel: r.classGroupName,
          value: Number(pct.toFixed(2)),
        });
      }
    }

    // 2) Habilidades críticas (< 50% promedio). TKT-05 — sin descriptores.
    const skillConditions = [
      inArray(skillResults.assessmentId, assessmentIds),
      notInArray(taxonomyNodes.type, [...RESULT_HIDDEN_NODE_TYPES]),
    ];
    if (studentIds !== null) skillConditions.push(inArray(skillResults.studentId, studentIds));

    const skillRows = await tx
      .select({
        nodeId: skillResults.nodeId,
        nodeName: taxonomyNodes.name,
        avgPct: sql<string | null>`avg(${skillResults.percentage}::numeric)`,
      })
      .from(skillResults)
      .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, skillResults.nodeId))
      .where(and(...skillConditions))
      .groupBy(skillResults.nodeId, taxonomyNodes.name);

    for (const r of skillRows) {
      const pct = r.avgPct == null ? null : Number(r.avgPct);
      if (pct != null && pct < 50) {
        alerts.push({
          type: 'critical_skill',
          severity: pct < 30 ? 'high' : 'medium',
          message: `La habilidad ${r.nodeName} tiene un logro promedio de ${pct.toFixed(1)}%`,
          contextId: r.nodeId,
          contextLabel: r.nodeName,
          value: Number(pct.toFixed(2)),
        });
      }
    }

    return alerts;
  }

  /** Períodos = academic_years de la org, año desc. */
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
