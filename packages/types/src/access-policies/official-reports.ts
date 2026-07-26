import type { UserRole } from '../enums';
import { RESULTS_VIEWER_ROLES } from './results-dashboards';

// Roles que pueden ver/generar los informes oficiales por curso (TKT-24) y
// por estudiante (TKT-26). Alias intencional de RESULTS_VIEWER_ROLES: el
// scoping por curso para profesores lo aplica el service (un profesor sólo ve
// sus cursos/alumnos).
export const OFFICIAL_REPORT_VIEWER_ROLES: readonly UserRole[] = RESULTS_VIEWER_ROLES;

// Roles que pueden ver el informe AGREGADO de establecimiento (TKT-25). Es
// una vista macro de toda la organización (no PII, sólo % y conteos) →
// directivos y coordinadores, NO profesores (que sólo tienen alcance de sus
// cursos).
export const ESTABLISHMENT_REPORT_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
];
