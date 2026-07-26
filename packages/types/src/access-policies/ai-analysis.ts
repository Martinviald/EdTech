import type { UserRole } from '../enums';

// Roles que pueden VER análisis IA (E20 / H19.23). Resultados + profesor.
export const AI_ANALYSIS_VIEWER_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
  'teacher',
];

// Roles que pueden GATILLAR generación de análisis IA (tiene costo) — sin teacher.
export const AI_ANALYSIS_GENERATOR_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
];
