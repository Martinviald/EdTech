import type { UserRole } from '../enums';

// Roles autorizados a ver datos psicopedagógicos/PII sensible (alumnos, etc.).
// Consumido directamente por SensitiveDataGuard (no vía @Roles/Reflector).
export const SENSITIVE_DATA_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'eval_coordinator',
];
