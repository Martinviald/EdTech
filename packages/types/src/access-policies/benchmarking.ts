import type { UserRole } from '../enums';

// Roles que gestionan la participación en benchmarking (opt-out + consentimiento, H19.24).
export const BENCHMARK_SETTINGS_ROLES: readonly UserRole[] = ['platform_admin', 'school_admin'];

// Roles que pueden VER benchmarking (decisión institucional/directiva, NO
// profesor: es comparación macro entre colegios). Incluye el director de
// sostenedor para el modo red identificado.
export const BENCHMARKING_VIEWER_ROLES: readonly UserRole[] = [
  'platform_admin',
  'foundation_director',
  'school_admin',
  'academic_director',
  'cycle_director',
  'eval_coordinator',
];

// Roles que pueden gatillar el refresh del read-model cross-tenant (operación global).
export const BENCHMARKING_ADMIN_ROLES: readonly UserRole[] = ['platform_admin'];
