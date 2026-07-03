import { z } from 'zod';

// ── F2 S5 — H18.1 Gating de tier pago ────────────────────────────────────────
// Las features pagas de F2 se gobiernan por `organizations.config.allowedFeatures`.
// F1 (ingesta DIA + dashboards) es SIEMPRE gratis (gancho PLG) y no se gatea.
// Fuente única de verdad de las claves de feature pagas.

export const FEATURE_KEYS = [
  'ai_analysis',
  'remedial',
  'benchmarking',
  'ai_assistant',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const featureKeySchema = z.enum(FEATURE_KEYS);

/** Etiqueta legible por humano para cada feature paga (UI). */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  ai_analysis: 'Análisis IA',
  remedial: 'IA Remedial',
  benchmarking: 'Benchmarking',
  ai_assistant: 'Asistente IA',
};

/**
 * Config tipada de una organización. `organizations.config` es JSONB genérico:
 * este schema valida/extrae sólo las claves que F2 conoce y deja pasar el resto
 * (`.passthrough()`) para no perder configuración de otros dominios.
 */
export const orgConfigSchema = z
  .object({
    /** Lista de features pagas habilitadas. `undefined` = default (ver isFeatureAllowed). */
    allowedFeatures: z.array(featureKeySchema).optional(),
    /** Presupuesto mensual de costo IA (USD) para alertas (H19.25). null/undefined = sin tope. */
    aiBudgetUsd: z.number().nonnegative().nullable().optional(),
  })
  .passthrough();
export type OrgConfig = z.infer<typeof orgConfigSchema>;

/**
 * ¿La org tiene habilitada esta feature paga?
 *
 * Política de default (piloto): si `allowedFeatures` NO está configurado, se
 * habilitan TODAS las features pagas. Esto evita romper los colegios piloto que
 * aún no tienen plan asignado. El mecanismo de gating queda activo y listo; pasar
 * a opt-in real (deny-by-default) es cambiar el fallback a `false` y sembrar
 * `config.allowedFeatures` por org. Los `platform_admin` se saltan el chequeo en
 * el guard (no acá).
 */
export function isFeatureAllowed(
  config: OrgConfig | Record<string, unknown> | null | undefined,
  feature: FeatureKey,
): boolean {
  const parsed = orgConfigSchema.safeParse(config ?? {});
  const allowed = parsed.success ? parsed.data.allowedFeatures : undefined;
  if (!allowed) return true; // default piloto: todo habilitado
  return allowed.includes(feature);
}

/** Resuelve la lista efectiva de features habilitadas (para exponer al frontend). */
export function resolveAllowedFeatures(
  config: OrgConfig | Record<string, unknown> | null | undefined,
): FeatureKey[] {
  return FEATURE_KEYS.filter((f) => isFeatureAllowed(config, f));
}

// ── Response / request models ────────────────────────────────────────────────

/** GET /organizations/me/features · GET /organizations/:orgId/features */
export const orgFeaturesResponseSchema = z.object({
  orgId: z.string().uuid(),
  /** Features pagas efectivamente habilitadas para esta org. */
  allowedFeatures: z.array(featureKeySchema),
  /** Presupuesto mensual de costo IA en USD, o null si no tiene tope. */
  aiBudgetUsd: z.number().nonnegative().nullable(),
});
export type OrgFeaturesResponse = z.infer<typeof orgFeaturesResponseSchema>;

/** PATCH /organizations/:orgId/features (FEATURE_MANAGEMENT_ROLES) */
export const updateOrgFeaturesSchema = z.object({
  allowedFeatures: z.array(featureKeySchema),
  aiBudgetUsd: z.number().nonnegative().nullable().optional(),
});
export type UpdateOrgFeaturesDto = z.infer<typeof updateOrgFeaturesSchema>;
