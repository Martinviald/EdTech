import type { UserRole } from '../enums';

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

// Los siguientes son alias intencionales de RESULTS_VIEWER_ROLES: dashboards,
// analítica y heatmap son distintas VISTAS sobre el mismo resultado, no
// distintos niveles de acceso. El scoping por curso para profesores lo aplica
// el service en cada caso, no estas constantes. Si algún día uno de estos
// necesita divergir de RESULTS_VIEWER_ROLES, ese es el momento de separarlo
// en su propia lista — no antes.
export const DASHBOARD_VIEWER_ROLES: readonly UserRole[] = RESULTS_VIEWER_ROLES;
export const ANALYTICS_VIEWER_ROLES: readonly UserRole[] = RESULTS_VIEWER_ROLES;
export const HEATMAP_VIEWER_ROLES: readonly UserRole[] = RESULTS_VIEWER_ROLES;
