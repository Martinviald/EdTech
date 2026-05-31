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

// Roles autorizados a gestionar el banco de ítems y pautas de instrumentos.
export const ITEM_BANK_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
];

// Roles que pueden ver ítems (lectura) pero no editarlos.
export const ITEM_VIEWER_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
  'teacher',
  'homeroom_teacher',
];

// Roles de "profesor" — usados para la vista "Mis cursos" que es la única
// excepción a la regla de unión: el isTeacherView se decide por activeRole,
// no por la unión, para que un usuario teacher+academic_director pueda
// alternar entre la vista de admin y la de profesor.
export const TEACHER_ROLES: readonly UserRole[] = [
  'teacher',
  'homeroom_teacher',
];

// Roles autorizados a importar hojas de respuesta (DIA, Gradecam, ZipGrade,
// archivo oficial). Coincide con IMPORT_ROLES + eval_coordinator (la persona
// que típicamente corre la corrección en el colegio).
export const ANSWER_SHEET_IMPORT_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
];

// Roles que pueden gestionar las escalas de notas del colegio.
export const GRADING_SCALE_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
];

// Roles que pueden ver los resultados consolidados de una evaluación.
// Profesores ven sólo los resultados de sus cursos asignados — el scoping por
// teacher_assignments lo aplica el service, no esta constante.
export const RESULTS_VIEWER_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
  'teacher',
  'homeroom_teacher',
];

// Roles que pueden gatillar el recálculo de resultados de una evaluación.
export const RESULTS_RECALCULATE_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
];

// Roles que pueden ver los dashboards de resultados (S4 — H6.1..H6.8). Mismo
// conjunto que RESULTS_VIEWER_ROLES: los dashboards son la capa de visualización
// sobre los resultados. El scoping por curso para profesores lo aplica el
// service, no esta constante.
export const DASHBOARD_VIEWER_ROLES: readonly UserRole[] = RESULTS_VIEWER_ROLES;

// Roles que pueden ver la analítica de series temporales (S4 — H6.3, H6.6:
// comparación de generaciones y progresión).
export const ANALYTICS_VIEWER_ROLES: readonly UserRole[] = RESULTS_VIEWER_ROLES;
