import type { UserRole } from '../enums';

// Roles que pueden VER material remedial. El profesor es el usuario principal
// del material (guía/ítems/plan para su aula), por eso se incluye.
export const REMEDIAL_VIEWER_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
  'teacher',
];

// Roles que pueden GATILLAR generación remedial (tiene costo IA). Incluye
// teacher: la generación de material remedial nace de la brecha del aula del
// profesor.
export const REMEDIAL_GENERATOR_ROLES: readonly UserRole[] = REMEDIAL_VIEWER_ROLES;

// Roles que pueden APROBAR/DESCARTAR material remedial (IA propone, humano
// aprueba). El profesor aprueba el material de su aula; coordinadores/directivos
// también.
export const REMEDIAL_APPROVER_ROLES: readonly UserRole[] = REMEDIAL_VIEWER_ROLES;
