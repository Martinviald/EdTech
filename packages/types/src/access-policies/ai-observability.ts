import type { UserRole } from '../enums';

// Roles que pueden ver el panel de observabilidad de costo/latencia IA. Es
// información de gasto/facturación → directivos, no profesores.
export const AI_OBSERVABILITY_VIEWER_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
];
