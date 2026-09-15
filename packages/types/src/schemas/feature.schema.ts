import { z } from 'zod';
import { orgBrandingSchema } from './organization.schema';
import { omrCalibrationSchema } from './omr-layout.schema';

// ── F2 S5 — H18.1 Gating de tier pago ────────────────────────────────────────
// Las features pagas de F2 se gobiernan por `organizations.config.allowedFeatures`.
// F1 (ingesta DIA + dashboards) es SIEMPRE gratis (gancho PLG) y no se gatea.
// Fuente única de verdad de las claves de feature pagas.

export const FEATURE_KEYS = [
  'ai_analysis',
  'remedial',
  'benchmarking',
  'ai_assistant',
  'mcp',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const featureKeySchema = z.enum(FEATURE_KEYS);

/** Etiqueta legible por humano para cada feature paga (UI). */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  ai_analysis: 'Análisis IA',
  remedial: 'IA Remedial',
  benchmarking: 'Benchmarking',
  ai_assistant: 'Asistente IA',
  mcp: 'Servidor MCP analítico',
};

/**
 * Config tipada de una organización. `organizations.config` es JSONB genérico:
 * este schema valida/extrae sólo las claves que F2 conoce y deja pasar el resto
 * (`.passthrough()`) para no perder configuración de otros dominios.
 */
/**
 * Ajustes de la cola de revisión de hojas (B1). `quickConfirm`: cuando el motor
 * sugiere una alternativa en una marca dudosa, el revisor la confirma con
 * Sí/No en vez de elegir entre todas las opciones. Apagado por defecto en el
 * primer ciclo; se enciende por org.
 */
export const orgReviewSettingsSchema = z.object({
  quickConfirm: z.boolean().optional(),
  /**
   * B2: una doble marca (`multiple`) cuya `nullConfidence` alcance este valor
   * se anula sola al persistir (`reviewDecision = annulled`, `autoResolved`),
   * no entra a la cola y sigue reabrible. Ausente = apagado. Valor recomendado:
   * AUTO_ANNUL_RECOMMENDED_MIN_CONFIDENCE.
   */
  autoAnnulMinConfidence: z.number().min(0).max(1).optional(),
});
export type OrgReviewSettings = z.infer<typeof orgReviewSettingsSchema>;

/**
 * Medido sobre el corte real (services/omr/goldset/README-registro.md, pendientes
 * fase 4 y 6b): las dobles con ambas burbujas plenas dan 0.96–1.00; una doble con
 * una burbuja 0.2 de fill más clara que la otra, 0.10–0.14; un borrón junto a la
 * marca, 0.0. Con 0.9 se anulan solas las primeras y las otras siguen en revisión.
 */
export const AUTO_ANNUL_RECOMMENDED_MIN_CONFIDENCE = 0.9;

export const orgConfigSchema = z
  .object({
    /** Lista de features pagas habilitadas. `undefined` = default (ver isFeatureAllowed). */
    allowedFeatures: z.array(featureKeySchema).optional(),
    /** Presupuesto mensual de costo IA (USD) para alertas (H19.25). null/undefined = sin tope. */
    aiBudgetUsd: z.number().nonnegative().nullable().optional(),
    /** Branding del colegio (Editor de Materiales). Ver orgBrandingSchema. */
    branding: orgBrandingSchema.optional(),
    /** Calibración OMR por organización (CD-12). Ver omrCalibrationSchema. */
    omrCalibration: omrCalibrationSchema.optional(),
    /** Retención de imágenes escaneadas en días (CD-14). undefined = default 180. */
    omrRetentionDays: z.number().int().positive().optional(),
    /** Cola de revisión de hojas (B1). Ver orgReviewSettingsSchema. */
    review: orgReviewSettingsSchema.optional(),
  })
  .passthrough();
export type OrgConfig = z.infer<typeof orgConfigSchema>;

/** Umbral de nula automática de la org (B2), o `null` si está apagada. */
export function autoAnnulMinConfidence(
  config: OrgConfig | Record<string, unknown> | null | undefined,
): number | null {
  const parsed = orgConfigSchema.safeParse(config ?? {});
  if (!parsed.success) return null;
  return parsed.data.review?.autoAnnulMinConfidence ?? null;
}

/** ¿La org confirma sugerencias del motor con Sí/No? Apagado salvo `config.review.quickConfirm: true`. */
export function isQuickConfirmEnabled(
  config: OrgConfig | Record<string, unknown> | null | undefined,
): boolean {
  const parsed = orgConfigSchema.safeParse(config ?? {});
  return parsed.success && parsed.data.review?.quickConfirm === true;
}

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
