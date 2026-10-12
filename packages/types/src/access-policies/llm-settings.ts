import type { UserRole } from '../enums';

// Roles que pueden configurar qué modelo/proveedor de IA usa cada
// funcionalidad (panel /configuracion/modelos-ia). Hoy la config es GLOBAL
// (afecta a todas las orgs) → sólo platform_admin, igual que
// FEATURE_MANAGEMENT_ROLES. Cuando pase a per-org se sumará school_admin
// (sólo sobre las filas de su org).
export const LLM_SETTINGS_ROLES: readonly UserRole[] = ['platform_admin'];

// Roles que administran el catálogo global de modelos de IA y sus precios (tabla
// `llm_models`, /api/llm-models). Es un catálogo de plataforma sin datos de
// colegios → sólo platform_admin.
export const LLM_MODELS_ADMIN_ROLES: readonly UserRole[] = ['platform_admin'];
