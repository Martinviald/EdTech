import type { UserRole } from '../enums';

export const STAFF_MANAGEMENT_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
];

// GET /organizations/me — perfil básico del colegio. Audiencia más amplia:
// cualquier directivo/profesor que necesite saber en qué colegio está.
export const ORG_PROFILE_VIEWER_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'teacher',
];

// Administración de la estructura académica de la org (grados, asignaturas,
// profesores, subject-classes, class-groups). Mismo conjunto reutilizado en
// ~11 endpoints de OrganizationsController — no lo dupliques inline ahí.
export const ORG_ACADEMIC_ADMIN_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
];

// Identidad/perfil de la org (nombre, setup del año académico) — más
// restringido que ORG_ACADEMIC_ADMIN_ROLES: solo el dueño del colegio.
export const ORG_OWNER_ROLES: readonly UserRole[] = ['platform_admin', 'school_admin'];
