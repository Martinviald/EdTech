import type { UserRole } from '../enums';

/**
 * Quién puede VER la analítica de uso de la plataforma (telemetría agregada).
 *
 * Es data estratégica/operativa (qué features aportan valor), no pedagógica: la
 * ven admins y directivos, no profesores. La EMISIÓN de eventos, en cambio, la
 * hace cualquier usuario autenticado sobre su propio uso (no lleva constante:
 * el endpoint de ingesta sólo exige un JWT válido).
 */
export const TELEMETRY_VIEWER_ROLES: readonly UserRole[] = [
  'platform_admin',
  'foundation_director',
  'school_admin',
  'academic_director',
];
