import type { UserRole } from '../enums';

export const IMPORT_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
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
