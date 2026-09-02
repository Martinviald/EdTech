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
 * Se decide por el ROL ACTIVO del JWT (`user.activeRole`), no por la unión:
 * un usuario teacher + academic_director ve toda la org mientras su rol activo
 * sea el directivo, y sólo sus cursos cuando cambia a profesor. La unión sigue
 * gobernando la AUTORIZACIÓN de endpoints (`RolesGuard`).
 */
import { ForbiddenException } from '@nestjs/common';
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  assessmentCourseAssignments,
  classGroups,
  orgMemberships,
  studentEnrollments,
  students,
  subjectClasses,
  teacherAssignments,
} from '@soe/db';
import { RESULTS_VIEWER_ROLES, userHasAnyRole, userHasRole, type UserRole } from '@soe/types';
import type { JwtPayload } from '../../auth/jwt-payload.types';
import type { AnyColumn } from 'drizzle-orm';
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

/** Par (curso, asignatura) donde el usuario dicta. */
export type ScopePair = { classGroupId: string; subjectId: string };

export type ClassGroupScope = {
  scopeAll: boolean;
  /**
   * Unión de los cursos alcanzables (dicta o es jefe). Alcance por CURSO: se
   * usa para la visibilidad de personas (un alumno es visible si está en un
   * curso del alcance) y para las queries que aún no distinguen asignatura.
   */
  classGroupIds: string[];
  /** Pares (curso, asignatura) donde dicta. Vacío para admin-like. */
  pairs: ScopePair[];
  /**
   * Cursos donde es profesor jefe: acceso TRANSVERSAL a todas sus asignaturas.
   * Se leen de `org_memberships.scope.classGroupIds` del membership
   * `homeroom_teacher` (el rol por sí solo no dice de qué curso es jefe).
   */
  homeroomClassGroupIds: string[];
};

/** Campos vacíos del alcance. Función (no constante) para no compartir arreglos. */
const emptyScopeFields = (): Omit<ClassGroupScope, 'scopeAll'> => ({
  classGroupIds: [],
  pairs: [],
  homeroomClassGroupIds: [],
});

/**
 * Roles EFECTIVOS para decidir alcance: el rol activo, no la unión.
 *
 * `RolesGuard` autoriza por unión (quién ENTRA al endpoint); el alcance y la
 * vista se deciden por `activeRole` (qué VE). Un token legacy sin `activeRole`
 * cae a la unión, que es el comportamiento anterior.
 */
export function effectiveRolesFor(user: JwtPayload): UserRole[] {
  return user.activeRole ? [user.activeRole] : user.roles;
}

/**
 * ¿El caller mira la plataforma como PROFESOR (no como directivo)?
 *
 * Punto único de esta decisión: la usan el alcance, la vista "Mis cursos" y la
 * etiqueta `scope` de los dashboards. Tres criterios distintos para la misma
 * pregunta es cómo se produce una respuesta que se contradice a sí misma —
 * datos de profesor con cabecera de organización.
 */
export function isTeacherScope(user: JwtPayload): boolean {
  if (user.isPlatformAdmin) return false;
  return !userHasAnyRole(effectiveRolesFor(user), ADMIN_LIKE_ROLES);
}

/**
 * Resuelve el alcance por curso del caller dentro de una org. Corre bajo
 * `withOrgContext` (usa `tx`).
 */
export async function resolveClassGroupScope(
  tx: Database,
  user: JwtPayload,
  orgId: string,
): Promise<ClassGroupScope> {
  if (user.isPlatformAdmin) return { scopeAll: true, ...emptyScopeFields() };

  // Fase 4: el ALCANCE se decide por el rol ACTIVO, no por la unión de roles.
  //
  // `RolesGuard` sigue autorizando por unión (quién ENTRA al endpoint); esto
  // responde la otra pregunta, qué FILAS ve. Son dos cosas distintas y conviene
  // que quede escrito: un usuario teacher + dept_head entra a las mismas
  // pantallas siempre, pero con rol activo `teacher` ve sólo sus cursos y al
  // cambiar a `dept_head` ve la organización. Sin esto el selector de rol no
  // cambia nada y no se puede mostrar a un directivo lo que ve un profesor.
  const effectiveRoles = effectiveRolesFor(user);

  if (userHasAnyRole(effectiveRoles, ADMIN_LIKE_ROLES)) {
    return { scopeAll: true, ...emptyScopeFields() };
  }

  // Caller no admin-like — debe tener algún rol de RESULTS_VIEWER_ROLES que no
  // sea admin (teacher/homeroom_teacher). El RolesGuard ya bloqueó si no.
  if (!userHasAnyRole(effectiveRoles, RESULTS_VIEWER_ROLES)) {
    return { scopeAll: false, ...emptyScopeFields() };
  }

  const rows = await tx
    .select({
      classGroupId: subjectClasses.classGroupId,
      subjectId: subjectClasses.subjectId,
    })
    .from(teacherAssignments)
    .innerJoin(subjectClasses, eq(subjectClasses.id, teacherAssignments.subjectClassId))
    .innerJoin(classGroups, eq(classGroups.id, subjectClasses.classGroupId))
    .where(and(eq(teacherAssignments.userId, user.userId), eq(classGroups.orgId, orgId)));

  const pairs: ScopePair[] = [];
  const seenPair = new Set<string>();
  for (const r of rows) {
    const key = `${r.classGroupId}|${r.subjectId}`;
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    pairs.push({ classGroupId: r.classGroupId, subjectId: r.subjectId });
  }

  const homeroomClassGroupIds = await resolveHomeroomClassGroupIds(tx, user, orgId);

  const classGroupIds = Array.from(
    new Set([...pairs.map((p) => p.classGroupId), ...homeroomClassGroupIds]),
  );
  return { scopeAll: false, classGroupIds, pairs, homeroomClassGroupIds };
}

/**
 * Cursos donde el usuario es profesor jefe. El rol `homeroom_teacher` por sí
 * solo no identifica el curso: la jefatura concreta vive en
 * `org_memberships.scope.classGroupIds` (campo declarado en el schema para
 * acotar un membership). Se valida contra `class_groups` de la org para no
 * confiar en un JSONB con ids de otro tenant.
 */
async function resolveHomeroomClassGroupIds(
  tx: Database,
  user: JwtPayload,
  orgId: string,
): Promise<string[]> {
  // La jefatura acompaña al docente aunque su rol activo sea `teacher`: son dos
  // facetas del mismo trabajo de aula, no dos niveles de acceso.
  if (!userHasRole(user.roles, 'homeroom_teacher')) return [];

  const memberships = await tx
    .select({ scope: orgMemberships.scope })
    .from(orgMemberships)
    .where(
      and(
        eq(orgMemberships.userId, user.userId),
        eq(orgMemberships.orgId, orgId),
        eq(orgMemberships.role, 'homeroom_teacher'),
        eq(orgMemberships.isActive, true),
      ),
    );

  const declared = Array.from(new Set(memberships.flatMap((m) => m.scope?.classGroupIds ?? [])));
  if (declared.length === 0) return [];

  const valid = await tx
    .select({ id: classGroups.id })
    .from(classGroups)
    .where(and(eq(classGroups.orgId, orgId), inArray(classGroups.id, declared)));
  return valid.map((c) => c.id);
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

/**
 * Condición SQL que acota una query de evaluaciones al alcance del caller, en
 * sus DOS dimensiones (curso y asignatura).
 *
 * `assessments` no tiene asignatura ni curso propios: el curso llega por
 * `assessment_course_assignments` y la asignatura por `instruments.subject_id`.
 * Por eso la condición se arma sobre las columnas que la query ya tiene
 * joineadas y se pasa como parámetro — el helper no impone la forma del join.
 *
 * Semántica:
 *  - `scopeAll` → sin condición (`undefined`, se omite del `and()`).
 *  - Curso de jefatura → TODAS sus asignaturas (mirada transversal del jefe).
 *  - Resto → sólo los pares (curso, asignatura) donde dicta.
 *  - Alcance vacío → `false` (ninguna fila), nunca "sin filtro".
 */
export function buildAssessmentScopeCondition(
  scope: ClassGroupScope,
  columns: { classGroupId: AnyColumn; subjectId: AnyColumn },
): SQL | undefined {
  if (scope.scopeAll) return undefined;

  const terms: SQL[] = [];
  if (scope.homeroomClassGroupIds.length > 0) {
    terms.push(inArray(columns.classGroupId, scope.homeroomClassGroupIds));
  }
  for (const pair of scope.pairs) {
    // Un par del profesor jefe ya está cubierto por el término transversal.
    if (scope.homeroomClassGroupIds.includes(pair.classGroupId)) continue;
    terms.push(
      and(
        eq(columns.classGroupId, pair.classGroupId),
        eq(columns.subjectId, pair.subjectId),
      ) as SQL,
    );
  }

  if (terms.length === 0) return sql`false`;
  return terms.length === 1 ? terms[0] : (or(...terms) as SQL);
}

/**
 * ¿La evaluación cae dentro del alcance? Variante en memoria de
 * `buildAssessmentScopeCondition`, para cuando ya se cargaron los cursos de la
 * evaluación y su asignatura (p. ej. antes de servir un recurso por id).
 */
export function isAssessmentInScope(
  scope: ClassGroupScope,
  assessment: { classGroupIds: string[]; subjectId: string | null },
): boolean {
  if (scope.scopeAll) return true;
  if (assessment.classGroupIds.length === 0) return false;

  return assessment.classGroupIds.some((cg) => {
    if (scope.homeroomClassGroupIds.includes(cg)) return true;
    if (!assessment.subjectId) return false;
    return scope.pairs.some((p) => p.classGroupId === cg && p.subjectId === assessment.subjectId);
  });
}

/**
 * Predicado correlacionado "esta evaluación está en el alcance del caller",
 * listo para usarse en el `where` de una query sobre `assessments` que ya tenga
 * `instruments` joineado.
 *
 * Se resuelve como un `EXISTS` sobre `assessment_course_assignments`: una
 * evaluación entra si ALGUNO de sus cursos cae en el alcance (con la asignatura
 * del instrumento, salvo en los cursos de jefatura, que son transversales).
 *
 * A diferencia del filtro por curso a secas, aquí NO se deja pasar la
 * evaluación sin cursos asignados: sin curso no se puede afirmar que sea del
 * profesor. Para un caller `scopeAll` devuelve `undefined` y el `and()` la omite.
 */
export function buildAssessmentInScopeExists(
  scope: ClassGroupScope,
  columns: { assessmentId: AnyColumn; subjectId: AnyColumn },
): SQL | undefined {
  if (scope.scopeAll) return undefined;

  const condition = buildAssessmentScopeCondition(scope, {
    classGroupId: assessmentCourseAssignments.classGroupId,
    subjectId: columns.subjectId,
  });
  if (condition === undefined) return undefined;

  return sql`exists (select 1 from ${assessmentCourseAssignments} where ${eq(
    assessmentCourseAssignments.assessmentId,
    columns.assessmentId,
  )} and ${condition})`;
}

/**
 * Asignaturas que el caller puede ver DE UN ALUMNO concreto.
 *
 * La visibilidad de la persona ya se resolvió por curso
 * (`isStudentVisibleInScope`); esto responde la segunda pregunta: de ese alumno,
 * ¿qué asignaturas? Es la regla de jefatura aplicada a las vistas centradas en
 * el alumno (vista 360, panorama, señales):
 *  - `scopeAll`, o el alumno está en un curso de JEFATURA del caller → `null`
 *    (sin filtro: mirada transversal, que es justamente lo que necesita un
 *    profesor jefe para orientar).
 *  - Profesor de asignatura → sólo las asignaturas que dicta en los cursos donde
 *    ese alumno está matriculado.
 *
 * Corre bajo `withOrgContext` (usa `tx`).
 */
export async function resolveStudentSubjectFilter(
  tx: Database,
  scope: ClassGroupScope,
  studentId: string,
): Promise<Set<string> | null> {
  if (scope.scopeAll) return null;

  const enrollments = await tx
    .select({ classGroupId: studentEnrollments.classGroupId })
    .from(studentEnrollments)
    .where(eq(studentEnrollments.studentId, studentId));
  const studentCourses = new Set(enrollments.map((e) => e.classGroupId));

  if (scope.homeroomClassGroupIds.some((cg) => studentCourses.has(cg))) return null;

  return new Set(
    scope.pairs.filter((p) => studentCourses.has(p.classGroupId)).map((p) => p.subjectId),
  );
}

/**
 * Condición para un CATÁLOGO (curso, asignatura) —típicamente `subject_classes`—
 * acotado al alcance del caller.
 *
 * Misma semántica que `buildAssessmentScopeCondition`, sobre otras columnas: los
 * cursos de jefatura entran completos y del resto sólo los pares que dicta. Se
 * separa para que quede explícito que acá se filtra un catálogo (lo que la UI
 * OFRECE), no datos de alumnos: si esto se olvida, el desplegable revela qué
 * otras asignaturas se dictan en sus cursos y ofrece filtros que no devuelven
 * nada.
 */
export function buildSubjectCatalogCondition(
  scope: ClassGroupScope,
  columns: { classGroupId: AnyColumn; subjectId: AnyColumn },
): SQL | undefined {
  return buildAssessmentScopeCondition(scope, columns);
}
