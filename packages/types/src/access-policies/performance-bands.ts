import type { UserRole } from '../enums';

// Roles que pueden gestionar los niveles/umbrales de logro (performance_bands)
// por instrumento. Hoy las bandas de instrumentos oficiales son GLOBALES (org_id
// NULL, compartidas por todas las orgs) → sólo platform_admin, igual que
// LLM_SETTINGS_ROLES. La autoría de cortes oficiales es una decisión de plataforma,
// no de un colegio individual.
export const PERFORMANCE_BANDS_ADMIN_ROLES: readonly UserRole[] = ['platform_admin'];
