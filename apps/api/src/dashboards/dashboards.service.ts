import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  academicYears,
  assessmentResults,
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
  type DashboardSkillsResponse,
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

      // Métricas globales: promedio de % logro, alumnos distintos evaluados.
      const [metrics] = await tx
        .select({
          avgPct: sql<string | null>`avg(${assessmentResults.percentage}::numeric)`,
          studentsEvaluated: sql<number>`count(distinct ${assessmentResults.studentId})::int`,
          assessmentsCount: sql<number>`count(distinct ${assessmentResults.assessmentId})::int`,
        })
        .from(assessmentResults)
        .innerJoin(students, eq(students.id, assessmentResults.studentId))
        .where(and(...resultConditions, isNull(students.deletedAt)));

      const globalAchievement = metrics?.avgPct == null ? null : Number(metrics.avgPct);

      const distribution = await this.computePerformanceDistribution(
        tx,
        assessmentIds,
        studentIds,
      );

      const recentAssessments = await this.loadRecentAssessments(tx, orgId, scope, query, studentIds);

      const alerts = await this.deriveAlerts(tx, orgId, scope, query, studentIds, assessmentIds);

      return {
        scope: isTeacherScope ? 'teacher' : 'org',
        globalAchievement,
        studentsEvaluated: Number(metrics?.studentsEvaluated ?? 0),
        assessmentsCount: Number(metrics?.assessmentsCount ?? 0),
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
    const thresholds = { elementary: DEFAULT_THRESHOLDS.elementary, adequate: DEFAULT_THRESHOLDS.adequate, advanced: DEFAULT_THRESHOLDS.advanced };
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
        return { ...empty, thresholds: await this.resolveThresholds(tx, orgId, query, assessmentIds) };
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

      const scaleThresholds = { elementary: resolvedThresholds.elementary, adequate: resolvedThresholds.adequate, advanced: resolvedThresholds.advanced };

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

      const studentIds = await this.resolveScopedStudentIds(tx, orgId, scope, query);
      if (studentIds !== null && studentIds.length === 0) return { skills: [] };

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

      const conditions = [inArray(skillResults.assessmentId, assessmentIds)];
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

      const skills: SkillAchievementModel[] = rows.map((r) => {
        const pct = r.avgPct == null ? null : Number(r.avgPct);
        const band = pct == null ? null : classifyByBands(pct / 100, bands);
        return {
          nodeId: r.nodeId,
          nodeName: r.nodeName,
          nodeType: r.nodeType,
          nodeCode: r.nodeCode,
          parentId: r.parentId,
          studentsAssessed: Number(r.studentsAssessed ?? 0),
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
    if (query.academicYearId) cgConditions.push(eq(classGroups.academicYearId, query.academicYearId));

    const enrollConditions = [
      eq(students.orgId, orgId),
      isNull(students.deletedAt),
    ];
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
    if (query.academicYearId) cgConditions.push(eq(classGroups.academicYearId, query.academicYearId));

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

    // 2) Habilidades críticas (< 50% promedio).
    const skillConditions = [inArray(skillResults.assessmentId, assessmentIds)];
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

    const conditions = [eq(classGroups.orgId, orgId), inArray(studentEnrollments.studentId, studentIds)];
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
