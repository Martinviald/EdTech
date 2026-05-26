import type { UserRole } from './enums';

// Fuente única de verdad para los conjuntos de roles que controlan acceso a
// features/páginas. Consumido tanto por guards backend como por guards inline
// en server components del frontend. Si agregas una constante nueva acá,
// úsala en ambos lados — no la dupliques inline.

export const CURRICULUM_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
];

export const STAFF_MANAGEMENT_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
];

export const IMPORT_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
];

export const ASSIGNMENTS_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
];

export const CLASS_VIEWER_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
  'homeroom_teacher',
  'teacher',
];

// Roles autorizados a ver datos psicopedagógicos/PII sensible (alumnos, etc.).
export const SENSITIVE_DATA_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
];

// Roles de "profesor" — usados para la vista "Mis cursos" que es la única
// excepción a la regla de unión: el isTeacherView se decide por activeRole,
// no por la unión, para que un usuario teacher+academic_director pueda
// alternar entre la vista de admin y la de profesor.
export const TEACHER_ROLES: readonly UserRole[] = [
  'teacher',
  'homeroom_teacher',
];

// Roles autorizados a subir hojas de respuesta en bloque (CSV/Excel) y
// confirmar la ingesta a la BD. Incluye `eval_coordinator` porque es quien
// usualmente gestiona la corrección operativa del DIA/SIMCE en el colegio.
export const ANSWER_SHEET_IMPORT_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
];

// Roles autorizados a crear/editar/borrar grading_scales custom de su org.
// Las escalas globales (orgId null) sólo las puede tocar platform_admin.
export const GRADING_SCALE_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
];

// Roles autorizados a VER resultados agregados de assessments (dashboards,
// listados, detalle por alumno). Profesores ven sólo sus cursos asignados
// vía teacher_assignments (lo aplica el service, no este listado).
export const RESULTS_VIEWER_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
  'homeroom_teacher',
  'teacher',
];

// Roles autorizados a forzar el recálculo de resultados de un assessment.
export const RESULTS_RECALCULATE_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
];
