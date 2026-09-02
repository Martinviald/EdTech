/**
 * Alcance por curso (teacher scoping) para las vistas de resultados/analítica.
 *
 * Consolida la lógica que hoy replican como método privado idéntico
 * `AssessmentResultsService`, `DashboardsService`, `HeatmapService` y
 * `AnalyticsService` (`getAccessibleClassGroupIds` + `isStudentVisible`). Es un
 * data-access helper de `common/` — hermano de `cohort-item-stats.helper.ts`:
 * toma el `tx` de la transacción y consulta Drizzle, así que DEBE invocarse
 * dentro de `withOrgContext` (las tablas que toca —`teacher_assignments`,
 * `student_enrollments`, `students`— corren bajo RLS).
 *
 * Regla de alcance (CLAUDE.md §6.3):
 *  - `scopeAll = true`  → admin-like / platform_admin: ve todos los cursos de la org.
 *  - `scopeAll = false` → profesor puro: ve sólo los `class_groups` donde tiene
 *    una asignación activa (`teacher_assignments`).
 * Se decide por la UNIÓN de roles del JWT (`user.roles`): un usuario
 * teacher + academic_director ve toda la org (admin-like gana).
 */
import { ForbiddenException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  assessmentCourseAssignments,
  classGroups,
  studentEnrollments,
  students,
  subjectClasses,
  teacherAssignments,
} from '@soe/db';
import { RESULTS_VIEWER_ROLES, userHasAnyRole, type UserRole } from '@soe/types';
import type { JwtPayload } from '../../auth/jwt-payload.types';
import type { Database } from '../../database/database.types';

/**
 * Roles "administrativos" — ven todos los cursos de la org. Cualquier otro rol
 * con acceso (teacher, homeroom_teacher) ve sólo los cursos donde tiene
 * `teacher_assignments` activos.
 */
export const ADMIN_LIKE_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
];

export type ClassGroupScope = { scopeAll: boolean; classGroupIds: string[] };

/**
 * Resuelve el alcance por curso del caller dentro de una org. Corre bajo
 * `withOrgContext` (usa `tx`).
 */
export async function resolveClassGroupScope(
  tx: Database,
  user: JwtPayload,
  orgId: string,
): Promise<ClassGroupScope> {
  if (user.isPlatformAdmin) return { scopeAll: true, classGroupIds: [] };

  const adminLike = userHasAnyRole(user.roles, ADMIN_LIKE_ROLES);
  if (adminLike) return { scopeAll: true, classGroupIds: [] };

  // Caller no admin-like — debe tener algún rol de RESULTS_VIEWER_ROLES que no
  // sea admin (teacher/homeroom_teacher). El RolesGuard ya bloqueó si no.
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
 * ¿El alumno pertenece a la org y es visible para el caller según su alcance?
 * Un profesor sólo ve alumnos matriculados en alguno de sus cursos asignados.
 * Corre bajo `withOrgContext` (usa `tx`).
 */
export async function isStudentVisibleInScope(
  tx: Database,
  orgId: string,
  scope: ClassGroupScope,
  studentId: string,
): Promise<boolean> {
  const [student] = await tx
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.id, studentId), eq(students.orgId, orgId), isNull(students.deletedAt)))
    .limit(1);
  if (!student) return false;
  if (scope.scopeAll) return true;
  if (scope.classGroupIds.length === 0) return false;

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
  return !!enrollment;
}

/**
 * ¿El curso está dentro del alcance del caller?
 */
export function isClassGroupInScope(scope: ClassGroupScope, classGroupId: string): boolean {
  if (scope.scopeAll) return true;
  return scope.classGroupIds.includes(classGroupId);
}

/**
 * Verifica que un recurso derivado de datos de alumnos (análisis IA, material
 * remedial) caiga dentro del alcance del caller, y lanza `ForbiddenException`
 * si no.
 *
 * El recurso se ancla por curso explícito y/o por la evaluación de la que
 * deriva. Reglas para un caller sin `scopeAll`:
 *  - Con `classGroupId` → ese curso debe estar en su alcance.
 *  - Sin `classGroupId` pero con `assessmentId` → TODOS los cursos de la
 *    evaluación deben estar en su alcance (un recurso sin curso explícito es
 *    agregado sobre la evaluación completa; si abarca cursos ajenos, filtra
 *    datos de esos cursos).
 *  - Sin ninguno de los dos → se rechaza: no hay forma de acotarlo.
 *
 * Corre bajo `withOrgContext` (usa `tx`).
 */
export async function assertTargetInScope(
  tx: Database,
  scope: ClassGroupScope,
  target: { assessmentId?: string | null; classGroupId?: string | null },
): Promise<void> {
  if (scope.scopeAll) return;

  const denied = new ForbiddenException('No tienes acceso a los datos de este curso');

  if (target.classGroupId) {
    if (!isClassGroupInScope(scope, target.classGroupId)) throw denied;
    return;
  }

  if (!target.assessmentId) throw denied;

  const courses = await tx
    .select({ classGroupId: assessmentCourseAssignments.classGroupId })
    .from(assessmentCourseAssignments)
    .where(eq(assessmentCourseAssignments.assessmentId, target.assessmentId));

  if (courses.length === 0) throw denied;
  if (!courses.every((c) => isClassGroupInScope(scope, c.classGroupId))) throw denied;
}
