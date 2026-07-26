import type { UserRole } from '../enums';

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
