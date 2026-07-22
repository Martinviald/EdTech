import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  assessmentResults,
  assessments,
  classGroups,
  gradingScales,
  instruments,
  items,
  organizations,
  performanceBands,
  responses,
  skillResults,
  studentEnrollments,
  students,
  subjectClasses,
  taxonomyNodes,
  teacherAssignments,
  withOrgContext,
} from '@soe/db';
import {
  CAPABILITY_UNAVAILABLE_CODE,
  RESULTS_VIEWER_ROLES,
  capabilityUnavailableMessage,
  userHasAnyRole,
  type AssessmentResultModel,
  type AssessmentResultsListResponse,
  type CalculateAssessmentResultsRequestDto,
  type CalculateAssessmentResultsResponse,
  type DataGranularity,
  type GradingScaleParams,
  type ListAssessmentResultsQueryDto,
  type PerformanceBandView,
  type PerformanceLevel,
  type SkillResultModel,
  type SkillResultsListResponse,
  type StudentResultDetail,
  type UserRole,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { defaultLinearChileanScale } from './lib/result-aggregator';
import {
  RECOMPUTE_FROM_RESPONSES_POLICY,
  loadResponsesForPersist,
  persistAssessmentResults,
} from './lib/persist-results';
import { loadInstrumentBands } from '../performance-bands/lib/load-instrument-bands';

// Roles "administrativos" — ven todos los cursos de la org. Cualquier otro rol
// con acceso (teacher, homeroom_teacher) ve sólo los cursos donde tiene
// teacher_assignments activos.
const ADMIN_LIKE_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
];

/**
 * Construye la vista de banda para un resultado a partir de las columnas del
 * LEFT JOIN a performance_bands. `null` si el resultado no tiene banda asignada
 * (instrumentos sin bandas configuradas) → la UI cae al enum legacy.
 */
function toBandView(r: {
  bandKey: string | null;
  bandLabel: string | null;
  bandOrder: number | null;
  bandColor: string | null;
}): PerformanceBandView | null {
  if (r.bandKey === null || r.bandLabel === null || r.bandOrder === null) return null;
  return { key: r.bandKey, label: r.bandLabel, order: r.bandOrder, color: r.bandColor };
}

@Injectable()
export class AssessmentResultsService {
  constructor(@InjectDb() private readonly db: Database) {}

  // ───────────────────────────────────────────────────────────────────────────
  // POST /assessments/:id/results/calculate
  // ───────────────────────────────────────────────────────────────────────────

  async calculate(
    user: JwtPayload,
    assessmentId: string,
    dto: CalculateAssessmentResultsRequestDto,
  ): Promise<CalculateAssessmentResultsResponse> {
    const orgId = user.orgId;
    if (orgId === null) {
      throw new ForbiddenException('Usuario sin organización activa');
    }

    return withOrgContext(this.db, orgId, async (tx) => {
      const assessment = await this.requireAssessmentOwnedByUser(tx, user, assessmentId);

      // Un assessment `aggregate_only` no tiene `responses` que recalcular: sus
      // niveles vinieron dados por el informe oficial. Recalcularlo sería un
      // delete + reinsert que arrasa con lo importado (el early-return de
      // computeAndPersist lo salva sólo mientras haya CERO responses — con
      // responses parciales, no).
      if (assessment.dataGranularity === 'aggregate_only') {
        throw new ConflictException({
          statusCode: 409,
          error: 'CapabilityUnavailable',
          code: CAPABILITY_UNAVAILABLE_CODE,
          capability: 'student_matrix',
          message: `${capabilityUnavailableMessage('student_matrix')} Sus resultados no se recalculan.`,
        });
      }

      // Teacher scoping: si el caller no tiene roles administrativos y no es
      // platform_admin, debe ser teacher con al menos un course assignment que
      // toque algún curso elegible. Si no, 403.
      const scope = await this.getAccessibleClassGroupIds(tx, user, assessment.orgId);
      if (!scope.scopeAll && scope.classGroupIds.length === 0) {
        throw new ForbiddenException(
          'Sin acceso a cursos para calcular resultados de esta evaluación',
        );
      }

      const scale = await this.resolveGradingScale(
        tx,
        user,
        assessment.orgId,
        assessment.instrumentId,
        dto.gradingScaleId,
      );

      return this.computeAndPersist(tx, assessmentId, assessment.instrumentId, scale);
    });
  }

  /**
   * Núcleo del recálculo (compute + delete + reinsert) de un assessment. Puro
   * respecto a auth/scope: asume que el caller ya validó permisos y que `tx`
   * corre en el `withOrgContext` de la org dueña del assessment (RLS activo).
   * Reutilizado por `calculate` (path de usuario) y `recalculateByInstrument`
   * (path platform_admin cross-tenant).
   */
  private async computeAndPersist(
    tx: Database,
    assessmentId: string,
    instrumentId: string,
    scale: GradingScaleParams,
  ): Promise<CalculateAssessmentResultsResponse> {
    const computed = await loadResponsesForPersist(tx, assessmentId);

    if (computed.length === 0) {
      return {
        assessmentId,
        resultsCreated: 0,
        resultsUpdated: 0,
        skillResultsCreated: 0,
        skillResultsUpdated: 0,
        studentsProcessed: 0,
      };
    }

    // Bandas de logro del instrumento (fuente de verdad del nivel por
    // instrumento). Corre dentro de withOrgContext → RLS trae globales + org.
    const bands = await loadInstrumentBands(tx, instrumentId);

    // Cuántos resultados previos había — define created vs updated. Va ANTES del
    // delete + reinsert que hace persistAssessmentResults.
    const [{ priorResults, priorSkillResults }] = await tx
      .select({
        priorResults: sql<number>`(select count(*)::int from ${assessmentResults} where ${assessmentResults.assessmentId} = ${assessmentId})`,
        priorSkillResults: sql<number>`(select count(*)::int from ${skillResults} where ${skillResults.assessmentId} = ${assessmentId})`,
      })
      .from(sql`(values (1)) as _`);

    const { studentAggregates, skillAggregates } = await persistAssessmentResults(tx, {
      assessmentId,
      responses: computed,
      scale,
      bands,
      now: new Date(),
      policy: RECOMPUTE_FROM_RESPONSES_POLICY,
    });

    return {
      assessmentId,
      resultsCreated: Math.max(0, studentAggregates.length - priorResults),
      resultsUpdated: Math.min(priorResults, studentAggregates.length),
      skillResultsCreated: Math.max(0, skillAggregates.length - priorSkillResults),
      skillResultsUpdated: Math.min(priorSkillResults, skillAggregates.length),
      studentsProcessed: studentAggregates.length,
    };
  }

  /**
   * Recalcula los resultados de TODOS los assessments (de todas las orgs) que
   * usan un instrumento. Operación de plataforma (gate platform_admin en el
   * caller): se dispara al cambiar las bandas/umbrales de un instrumento para que
   * los gráficos de todos los colegios que rindieron esa evaluación reflejen los
   * nuevos cortes.
   *
   * Recorre org por org dentro de `withOrgContext` (RLS aísla cada tenant). Las
   * `organizations` no tienen RLS, así que se enumeran directamente.
   *
   * Los assessments `aggregate_only` se SALTAN y se reportan en
   * `assessmentsSkipped`. No tienen `percentage` que reclasificar (el nivel vino
   * dado por el informe oficial) y el delete + reinsert los borraría. Se reporta en
   * vez de lanzar: es un recálculo masivo cross-org y no puede fallar entero por uno.
   */
  async recalculateByInstrument(instrumentId: string): Promise<{
    assessmentsRecalculated: number;
    orgsAffected: number;
    studentsProcessed: number;
    assessmentsSkipped: string[];
  }> {
    const orgs = await this.db.select({ id: organizations.id }).from(organizations);

    let assessmentsRecalculated = 0;
    let studentsProcessed = 0;
    let orgsAffected = 0;
    const assessmentsSkipped: string[] = [];

    for (const org of orgs) {
      const summary = await withOrgContext(this.db, org.id, async (tx) => {
        const rows = await tx
          .select({ id: assessments.id, dataGranularity: assessments.dataGranularity })
          .from(assessments)
          .where(and(eq(assessments.instrumentId, instrumentId), eq(assessments.orgId, org.id)));
        if (rows.length === 0) return { assessments: 0, students: 0, skipped: [] as string[] };

        const recalculable = rows.filter((a) => a.dataGranularity !== 'aggregate_only');
        const skipped = rows.filter((a) => a.dataGranularity === 'aggregate_only').map((a) => a.id);
        if (recalculable.length === 0) return { assessments: 0, students: 0, skipped };

        const scale = await this.resolveInstrumentScaleOrDefault(tx, instrumentId);
        let students = 0;
        for (const a of recalculable) {
          const res = await this.computeAndPersist(tx, a.id, instrumentId, scale);
          students += res.studentsProcessed;
        }
        return { assessments: recalculable.length, students, skipped };
      });

      assessmentsSkipped.push(...summary.skipped);
      if (summary.assessments > 0) {
        orgsAffected += 1;
        assessmentsRecalculated += summary.assessments;
        studentsProcessed += summary.students;
      }
    }

    return { assessmentsRecalculated, orgsAffected, studentsProcessed, assessmentsSkipped };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET /assessments/:id/results
  // ───────────────────────────────────────────────────────────────────────────

  async list(
    user: JwtPayload,
    assessmentId: string,
    query: ListAssessmentResultsQueryDto,
  ): Promise<AssessmentResultsListResponse> {
    const orgId = user.orgId;
    if (orgId === null) {
      throw new ForbiddenException('Usuario sin organización activa');
    }

    return withOrgContext(this.db, orgId, async (tx) => {
      const assessment = await this.requireAssessmentOwnedByUser(tx, user, assessmentId);
      const scope = await this.getAccessibleClassGroupIds(tx, user, assessment.orgId);

      if (!scope.scopeAll && scope.classGroupIds.length === 0) {
        return { data: [], total: 0, page: query.page, limit: query.limit };
      }

      const accessibleStudentIds = await this.resolveAccessibleStudentIds(
        tx,
        assessment.orgId,
        scope,
        query.classGroupId,
      );

      if (accessibleStudentIds !== null && accessibleStudentIds.length === 0) {
        return { data: [], total: 0, page: query.page, limit: query.limit };
      }

      const conditions = [eq(assessmentResults.assessmentId, assessmentId)];
      if (accessibleStudentIds !== null) {
        conditions.push(inArray(assessmentResults.studentId, accessibleStudentIds));
      }
      if (query.performanceLevel) {
        conditions.push(eq(assessmentResults.performanceLevel, query.performanceLevel));
      }

      const [countRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(assessmentResults)
        .innerJoin(students, eq(students.id, assessmentResults.studentId))
        .where(and(...conditions, isNull(students.deletedAt)));

      const total = Number(countRow?.total ?? 0);

      const rows = await tx
        .select({
          id: assessmentResults.id,
          assessmentId: assessmentResults.assessmentId,
          studentId: assessmentResults.studentId,
          studentRut: students.rut,
          firstName: students.firstName,
          lastName: students.lastName,
          totalScore: assessmentResults.totalScore,
          maxScore: assessmentResults.maxScore,
          percentage: assessmentResults.percentage,
          grade: assessmentResults.grade,
          performanceLevel: assessmentResults.performanceLevel,
          bandKey: performanceBands.key,
          bandLabel: performanceBands.label,
          bandOrder: performanceBands.order,
          bandColor: performanceBands.color,
          isComplete: assessmentResults.isComplete,
          completedAt: assessmentResults.completedAt,
          createdAt: assessmentResults.createdAt,
          updatedAt: assessmentResults.updatedAt,
        })
        .from(assessmentResults)
        .innerJoin(students, eq(students.id, assessmentResults.studentId))
        .leftJoin(performanceBands, eq(performanceBands.id, assessmentResults.performanceBandId))
        .where(and(...conditions, isNull(students.deletedAt)))
        .orderBy(students.lastName, students.firstName)
        .limit(query.limit)
        .offset((query.page - 1) * query.limit);

      return {
        data: rows.map((r) => this.toAssessmentResultModel(r)),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET /assessments/:id/skill-results
  // ───────────────────────────────────────────────────────────────────────────

  async listSkillResults(
    user: JwtPayload,
    assessmentId: string,
    query: Pick<ListAssessmentResultsQueryDto, 'classGroupId' | 'page' | 'limit'>,
  ): Promise<SkillResultsListResponse> {
    const orgId = user.orgId;
    if (orgId === null) {
      throw new ForbiddenException('Usuario sin organización activa');
    }

    return withOrgContext(this.db, orgId, async (tx) => {
      const assessment = await this.requireAssessmentOwnedByUser(tx, user, assessmentId);
      const scope = await this.getAccessibleClassGroupIds(tx, user, assessment.orgId);

      if (!scope.scopeAll && scope.classGroupIds.length === 0) {
        return { data: [], total: 0, page: query.page, limit: query.limit };
      }

      const accessibleStudentIds = await this.resolveAccessibleStudentIds(
        tx,
        assessment.orgId,
        scope,
        query.classGroupId,
      );

      if (accessibleStudentIds !== null && accessibleStudentIds.length === 0) {
        return { data: [], total: 0, page: query.page, limit: query.limit };
      }

      const conditions = [eq(skillResults.assessmentId, assessmentId)];
      if (accessibleStudentIds !== null) {
        conditions.push(inArray(skillResults.studentId, accessibleStudentIds));
      }

      const [countRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(skillResults)
        .where(and(...conditions));

      const total = Number(countRow?.total ?? 0);

      const rows = await tx
        .select({
          id: skillResults.id,
          assessmentId: skillResults.assessmentId,
          studentId: skillResults.studentId,
          nodeId: skillResults.nodeId,
          nodeName: taxonomyNodes.name,
          nodeType: taxonomyNodes.type,
          correctCount: skillResults.correctCount,
          totalCount: skillResults.totalCount,
          percentage: skillResults.percentage,
          performanceLevel: skillResults.performanceLevel,
          bandKey: performanceBands.key,
          bandLabel: performanceBands.label,
          bandOrder: performanceBands.order,
          bandColor: performanceBands.color,
          createdAt: skillResults.createdAt,
          updatedAt: skillResults.updatedAt,
        })
        .from(skillResults)
        .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, skillResults.nodeId))
        .leftJoin(performanceBands, eq(performanceBands.id, skillResults.performanceBandId))
        .where(and(...conditions))
        .orderBy(taxonomyNodes.name)
        .limit(query.limit)
        .offset((query.page - 1) * query.limit);

      return {
        data: rows.map((r) => this.toSkillResultModel(r)),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET /assessments/:id/results/:studentId
  // ───────────────────────────────────────────────────────────────────────────

  async getStudentDetail(
    user: JwtPayload,
    assessmentId: string,
    studentId: string,
  ): Promise<StudentResultDetail> {
    const orgId = user.orgId;
    if (orgId === null) {
      throw new ForbiddenException('Usuario sin organización activa');
    }

    return withOrgContext(this.db, orgId, async (tx) => {
      const assessment = await this.requireAssessmentOwnedByUser(tx, user, assessmentId);
      const scope = await this.getAccessibleClassGroupIds(tx, user, assessment.orgId);

      if (!scope.scopeAll && scope.classGroupIds.length === 0) {
        throw new NotFoundException('Resultado de alumno no encontrado');
      }

      // Verificar que el alumno es accesible para este caller dentro del org.
      if (!scope.scopeAll) {
        const [enrollment] = await tx
          .select({ id: studentEnrollments.id })
          .from(studentEnrollments)
          .where(
            and(
              eq(studentEnrollments.studentId, studentId),
              inArray(studentEnrollments.classGroupId, scope.classGroupIds),
            ),
          )
          .limit(1);
        if (!enrollment) {
          throw new NotFoundException('Resultado de alumno no encontrado');
        }
      }

      const [resultRow] = await tx
        .select({
          id: assessmentResults.id,
          assessmentId: assessmentResults.assessmentId,
          studentId: assessmentResults.studentId,
          studentRut: students.rut,
          firstName: students.firstName,
          lastName: students.lastName,
          totalScore: assessmentResults.totalScore,
          maxScore: assessmentResults.maxScore,
          percentage: assessmentResults.percentage,
          grade: assessmentResults.grade,
          performanceLevel: assessmentResults.performanceLevel,
          bandKey: performanceBands.key,
          bandLabel: performanceBands.label,
          bandOrder: performanceBands.order,
          bandColor: performanceBands.color,
          isComplete: assessmentResults.isComplete,
          completedAt: assessmentResults.completedAt,
          createdAt: assessmentResults.createdAt,
          updatedAt: assessmentResults.updatedAt,
        })
        .from(assessmentResults)
        .innerJoin(students, eq(students.id, assessmentResults.studentId))
        .leftJoin(performanceBands, eq(performanceBands.id, assessmentResults.performanceBandId))
        .where(
          and(
            eq(assessmentResults.assessmentId, assessmentId),
            eq(assessmentResults.studentId, studentId),
            eq(students.orgId, assessment.orgId),
            isNull(students.deletedAt),
          ),
        )
        .limit(1);

      if (!resultRow) {
        throw new NotFoundException('Resultado de alumno no encontrado');
      }

      const skillRows = await tx
        .select({
          id: skillResults.id,
          assessmentId: skillResults.assessmentId,
          studentId: skillResults.studentId,
          nodeId: skillResults.nodeId,
          nodeName: taxonomyNodes.name,
          nodeType: taxonomyNodes.type,
          correctCount: skillResults.correctCount,
          totalCount: skillResults.totalCount,
          percentage: skillResults.percentage,
          performanceLevel: skillResults.performanceLevel,
          bandKey: performanceBands.key,
          bandLabel: performanceBands.label,
          bandOrder: performanceBands.order,
          bandColor: performanceBands.color,
          createdAt: skillResults.createdAt,
          updatedAt: skillResults.updatedAt,
        })
        .from(skillResults)
        .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, skillResults.nodeId))
        .leftJoin(performanceBands, eq(performanceBands.id, skillResults.performanceBandId))
        .where(
          and(eq(skillResults.assessmentId, assessmentId), eq(skillResults.studentId, studentId)),
        )
        .orderBy(taxonomyNodes.name);

      const responseRows = await tx
        .select({
          itemId: responses.itemId,
          itemPosition: items.position,
          value: responses.value,
          isCorrect: responses.isCorrect,
          rawScore: responses.rawScore,
          finalScore: responses.finalScore,
          maxScore: responses.maxScore,
        })
        .from(responses)
        .innerJoin(items, eq(items.id, responses.itemId))
        .where(and(eq(responses.assessmentId, assessmentId), eq(responses.studentId, studentId)))
        .orderBy(items.position);

      return {
        result: this.toAssessmentResultModel(resultRow),
        skillResults: skillRows.map((r) => this.toSkillResultModel(r)),
        responses: responseRows.map((r) => ({
          itemId: r.itemId,
          itemPosition: r.itemPosition,
          rawAnswer: this.extractRawAnswer(r.value),
          isCorrect: r.isCorrect,
          rawScore: r.rawScore,
          finalScore: r.finalScore,
          maxScore: r.maxScore,
        })),
      };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers privados
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Decide el alcance del usuario para resultados de una evaluación:
   *  - `scopeAll = true`  → admin-like, ve todos los cursos de la org.
   *  - `scopeAll = false` → teacher puro, ve sólo sus class_groups asignados.
   *
   * Se usa la unión de roles del JWT (`user.roles`) — un usuario teacher +
   * academic_director ve todo (admin-like gana).
   */
  private async getAccessibleClassGroupIds(
    tx: Database,
    user: JwtPayload,
    assessmentOrgId: string,
  ): Promise<{ scopeAll: boolean; classGroupIds: string[] }> {
    if (user.isPlatformAdmin) return { scopeAll: true, classGroupIds: [] };

    const adminLike = userHasAnyRole(user.roles, ADMIN_LIKE_ROLES);
    if (adminLike) return { scopeAll: true, classGroupIds: [] };

    // Caller no es admin-like — debe tener algún rol de RESULTS_VIEWER_ROLES
    // que no sea admin (teacher/homeroom_teacher). RolesGuard ya bloqueó si no.
    if (!userHasAnyRole(user.roles, RESULTS_VIEWER_ROLES)) {
      return { scopeAll: false, classGroupIds: [] };
    }

    const rows = await tx
      .select({ classGroupId: subjectClasses.classGroupId })
      .from(teacherAssignments)
      .innerJoin(subjectClasses, eq(subjectClasses.id, teacherAssignments.subjectClassId))
      .innerJoin(classGroups, eq(classGroups.id, subjectClasses.classGroupId))
      .where(
        and(eq(teacherAssignments.userId, user.userId), eq(classGroups.orgId, assessmentOrgId)),
      );

    const ids = Array.from(new Set(rows.map((r) => r.classGroupId)));
    return { scopeAll: false, classGroupIds: ids };
  }

  /**
   * Resuelve el set de studentIds visibles para esta consulta, combinando el
   * scope del rol y el filtro opcional por classGroupId.
   *
   * Retorna `null` si el caller tiene scopeAll y no hay filtro de
   * classGroupId — significa "sin filtro extra de student".
   */
  private async resolveAccessibleStudentIds(
    tx: Database,
    orgId: string,
    scope: { scopeAll: boolean; classGroupIds: string[] },
    classGroupId: string | undefined,
  ): Promise<string[] | null> {
    if (scope.scopeAll && !classGroupId) {
      return null;
    }

    let allowedClassGroupIds: string[];
    if (scope.scopeAll) {
      // El caller pide un filtro por classGroup; validar que pertenece a la org.
      const [cg] = await tx
        .select({ id: classGroups.id })
        .from(classGroups)
        .where(and(eq(classGroups.id, classGroupId!), eq(classGroups.orgId, orgId)))
        .limit(1);
      if (!cg) return [];
      allowedClassGroupIds = [cg.id];
    } else {
      if (classGroupId) {
        if (!scope.classGroupIds.includes(classGroupId)) return [];
        allowedClassGroupIds = [classGroupId];
      } else {
        allowedClassGroupIds = scope.classGroupIds;
      }
    }

    if (allowedClassGroupIds.length === 0) return [];

    const rows = await tx
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

  /**
   * Verifica que el assessment exista y pertenezca al org del caller. Lanza
   * 404 — no filtrar existencia entre orgs.
   */
  private async requireAssessmentOwnedByUser(
    tx: Database,
    user: JwtPayload,
    assessmentId: string,
  ): Promise<{
    id: string;
    orgId: string;
    instrumentId: string;
    dataGranularity: DataGranularity;
  }> {
    const [row] = await tx
      .select({
        id: assessments.id,
        orgId: assessments.orgId,
        instrumentId: assessments.instrumentId,
        dataGranularity: assessments.dataGranularity,
      })
      .from(assessments)
      .where(eq(assessments.id, assessmentId))
      .limit(1);

    if (!row) {
      throw new NotFoundException('Evaluación no encontrada');
    }

    // Multi-tenancy: platform_admin puede ver cualquier org, los demás sólo su
    // org. No diferenciamos 404 vs 403 para no filtrar existencia.
    if (!user.isPlatformAdmin && row.orgId !== user.orgId) {
      throw new NotFoundException('Evaluación no encontrada');
    }

    return row;
  }

  /**
   * Resuelve la escala de notas a usar:
   *  1. dto.gradingScaleId (si se especifica, debe ser visible para la org).
   *  2. instrument.gradingScaleId (si existe).
   *  3. Default linear_chilean 1.0-7.0 / threshold 0.6.
   */
  private async resolveGradingScale(
    tx: Database,
    user: JwtPayload,
    orgId: string,
    instrumentId: string,
    requestedScaleId: string | undefined,
  ): Promise<GradingScaleParams> {
    if (requestedScaleId) {
      const [scale] = await tx
        .select()
        .from(gradingScales)
        .where(eq(gradingScales.id, requestedScaleId))
        .limit(1);
      if (scale && (scale.orgId === null || scale.orgId === orgId || user.isPlatformAdmin)) {
        return this.toGradingScaleParams(scale);
      }
    }

    return this.resolveInstrumentScaleOrDefault(tx, instrumentId);
  }

  /**
   * Escala del instrumento (o default linear_chilean) sin depender de un `user`
   * ni de un scale solicitado. Usado por el recálculo cross-tenant.
   */
  private async resolveInstrumentScaleOrDefault(
    tx: Database,
    instrumentId: string,
  ): Promise<GradingScaleParams> {
    const [instrument] = await tx
      .select({ gradingScaleId: instruments.gradingScaleId })
      .from(instruments)
      .where(eq(instruments.id, instrumentId))
      .limit(1);

    if (instrument?.gradingScaleId) {
      const [scale] = await tx
        .select()
        .from(gradingScales)
        .where(eq(gradingScales.id, instrument.gradingScaleId))
        .limit(1);
      if (scale) return this.toGradingScaleParams(scale);
    }

    return defaultLinearChileanScale();
  }

  private toGradingScaleParams(scale: {
    type: string;
    minGrade: string;
    maxGrade: string;
    passingGrade: string;
    passingThreshold: string;
    config: Record<string, unknown> | null;
  }): GradingScaleParams {
    return {
      type: scale.type,
      minGrade: Number(scale.minGrade),
      maxGrade: Number(scale.maxGrade),
      passingGrade: Number(scale.passingGrade),
      passingThreshold: Number(scale.passingThreshold),
      config: scale.config,
    };
  }

  private toAssessmentResultModel(r: {
    id: string;
    assessmentId: string;
    studentId: string;
    studentRut: string;
    firstName: string;
    lastName: string;
    totalScore: string | null;
    maxScore: string | null;
    percentage: string | null;
    grade: string | null;
    performanceLevel: PerformanceLevel | null;
    bandKey: string | null;
    bandLabel: string | null;
    bandOrder: number | null;
    bandColor: string | null;
    isComplete: boolean;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): AssessmentResultModel {
    return {
      id: r.id,
      assessmentId: r.assessmentId,
      studentId: r.studentId,
      studentRut: r.studentRut,
      studentFullName: `${r.firstName} ${r.lastName}`.trim(),
      totalScore: r.totalScore,
      maxScore: r.maxScore,
      percentage: r.percentage,
      grade: r.grade,
      performanceLevel: r.performanceLevel,
      performanceBand: toBandView(r),
      isComplete: r.isComplete,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private toSkillResultModel(r: {
    id: string;
    assessmentId: string;
    studentId: string;
    nodeId: string;
    nodeName: string;
    nodeType: string;
    correctCount: number;
    totalCount: number;
    percentage: string | null;
    performanceLevel: PerformanceLevel | null;
    bandKey: string | null;
    bandLabel: string | null;
    bandOrder: number | null;
    bandColor: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): SkillResultModel {
    return {
      id: r.id,
      assessmentId: r.assessmentId,
      studentId: r.studentId,
      nodeId: r.nodeId,
      nodeName: r.nodeName,
      nodeType: r.nodeType,
      correctCount: r.correctCount,
      totalCount: r.totalCount,
      percentage: r.percentage,
      performanceLevel: r.performanceLevel,
      performanceBand: toBandView(r),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  /**
   * Extrae la respuesta cruda del JSONB `value`. Convención: el ingestor guarda
   * `{ raw: "B" }` o `{ key: "B" }` o similar. Devolvemos string|null sin
   * inventar formato.
   */
  private extractRawAnswer(value: Record<string, unknown>): string | null {
    if (!value || typeof value !== 'object') return null;
    const raw =
      (value as Record<string, unknown>).raw ??
      (value as Record<string, unknown>).key ??
      (value as Record<string, unknown>).answer;
    if (raw == null) return null;
    return typeof raw === 'string' ? raw : String(raw);
  }
}
