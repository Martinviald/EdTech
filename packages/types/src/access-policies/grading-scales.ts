import type { UserRole } from '../enums';

// Roles que pueden gestionar las escalas de notas del colegio.
export const GRADING_SCALE_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
];
