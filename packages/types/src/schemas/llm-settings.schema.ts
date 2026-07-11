import { z } from 'zod';

/**
 * Configuración de modelos de IA por funcionalidad (panel /configuracion/modelos-ia).
 *
 * Cada "funcionalidad" (`LlmFeature`) es un punto de llamada al LLM. Un
 * `platform_admin` elige, por funcionalidad, el PROVEEDOR (Gemini/Claude) y el
 * MODELO. La elección se persiste en la tabla `llm_settings` (global por ahora,
 * `org_id = NULL`; per-org en el futuro) y `LlmConfigService.resolve` la consulta
 * en runtime. Este archivo es la fuente ÚNICA compartida FE/BE: catálogo de
 * modelos, defaults de código y validación.
 */

// ── Funcionalidades configurables ────────────────────────────────────────────
// Granularidad acordada: las 3 generaciones remediales (guía/práctica/plan grupal)
// se agrupan en `remedial`.
export const LLM_FEATURES = [
  'assessment_analysis',
  'item_insight',
  'instrument_comparison',
  'remedial',
  'ai_tagging',
  'assistant',
] as const;
export type LlmFeature = (typeof LLM_FEATURES)[number];
export const llmFeatureSchema = z.enum(LLM_FEATURES);

/** Etiqueta + descripción legibles por funcionalidad (UI del panel). */
export const LLM_FEATURE_LABELS: Record<LlmFeature, { label: string; description: string }> = {
  assessment_analysis: {
    label: 'Análisis IA — Informe de evaluación',
    description:
      'Informe pedagógico de una evaluación completa (síntesis, brechas, recomendaciones).',
  },
  item_insight: {
    label: 'Análisis IA por pregunta',
    description:
      'Análisis de una pregunta individual (causa, distractores, pasaje/imagen). Requiere modelo multimodal.',
  },
  instrument_comparison: {
    label: 'Análisis IA — Comparación de instrumentos',
    description:
      'Diagnóstico cualitativo de la variación entre dos instrumentos comparables (año vs año): qué cambió en el contenido y por qué variaron los resultados.',
  },
  remedial: {
    label: 'Material Remedial',
    description: 'Guías de reenseñanza, sets de práctica y planes remediales por grupo.',
  },
  ai_tagging: {
    label: 'Auto-etiquetado de ítems',
    description: 'Sugerencias de taxonomía (habilidades) para ítems del banco.',
  },
  assistant: {
    label: 'Asistente IA conversacional',
    description: 'Chat con herramientas para directivos (streaming).',
  },
};

// ── Proveedores configurables ────────────────────────────────────────────────
// Subconjunto de `LlmProviderName` con provider implementado y seleccionable hoy.
export const LLM_PROVIDERS = ['gemini', 'anthropic'] as const;
export type LlmProviderId = (typeof LLM_PROVIDERS)[number];
export const llmProviderSchema = z.enum(LLM_PROVIDERS);

export const LLM_PROVIDER_LABELS: Record<LlmProviderId, string> = {
  gemini: 'Google Gemini',
  anthropic: 'Anthropic Claude',
};

// ── Catálogo de modelos ──────────────────────────────────────────────────────
export interface LlmModelOption {
  /** Identificador exacto del modelo en el proveedor. */
  id: string;
  /** Etiqueta legible (UI). */
  label: string;
  /** Tope de tokens de salida derivado del modelo (no editable por el usuario). */
  maxTokens: number;
  /** El modelo acepta imágenes (necesario para `item_insight`). */
  multimodal: boolean;
}

/**
 * Modelos seleccionables por proveedor. Punto único: agregar/quitar un modelo es
 * editar esta lista. `maxTokens` se deriva de aquí (el panel NO lo expone).
 */
export const LLM_MODEL_CATALOG: Record<LlmProviderId, readonly LlmModelOption[]> = {
  gemini: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', maxTokens: 8192, multimodal: true },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', maxTokens: 32768, multimodal: true },
    {
      id: 'gemini-2.5-flash-lite',
      label: 'Gemini 2.5 Flash-Lite',
      maxTokens: 8192,
      multimodal: true,
    },
  ],
  anthropic: [
    {
      id: 'claude-haiku-4-5-20251001',
      label: 'Claude Haiku 4.5',
      maxTokens: 8192,
      multimodal: true,
    },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', maxTokens: 16384, multimodal: true },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', maxTokens: 16384, multimodal: true },
  ],
};

/** Busca un modelo en el catálogo. `undefined` si no existe para ese proveedor. */
export function findModelOption(
  provider: LlmProviderId,
  model: string,
): LlmModelOption | undefined {
  return LLM_MODEL_CATALOG[provider].find((m) => m.id === model);
}

/** Tope de tokens de un modelo; fallback conservador si no está en el catálogo. */
export function resolveModelMaxTokens(provider: LlmProviderId, model: string): number {
  return findModelOption(provider, model)?.maxTokens ?? 4096;
}

// ── Defaults de código (fallback cuando no hay fila en llm_settings) ──────────
export interface LlmModelChoice {
  provider: LlmProviderId;
  model: string;
}

/**
 * Modelo por funcionalidad cuando no hay configuración persistida. Punto único de
 * defaults: análisis (informe + por-pregunta) en Pro; el resto en Flash.
 */
export const LLM_FEATURE_DEFAULTS: Record<LlmFeature, LlmModelChoice> = {
  assessment_analysis: { provider: 'gemini', model: 'gemini-2.5-pro' },
  item_insight: { provider: 'gemini', model: 'gemini-2.5-pro' },
  // Comparación de instrumentos: razonamiento cualitativo sobre contenido +
  // resultados de dos instrumentos → modelo potente (Pro) por defecto.
  instrument_comparison: { provider: 'gemini', model: 'gemini-2.5-pro' },
  remedial: { provider: 'gemini', model: 'gemini-2.5-flash' },
  ai_tagging: { provider: 'gemini', model: 'gemini-2.5-flash' },
  assistant: { provider: 'gemini', model: 'gemini-2.5-flash' },
};

/** Funcionalidades que exigen un modelo multimodal (envían imágenes al LLM). */
export const MULTIMODAL_FEATURES: readonly LlmFeature[] = ['item_insight'];

// ── Request / Response models ────────────────────────────────────────────────

/** PATCH /api/llm-settings/:feature (LLM_SETTINGS_ROLES). */
export const updateLlmSettingSchema = z
  .object({
    provider: llmProviderSchema,
    model: z.string().min(1),
  })
  .refine((v) => findModelOption(v.provider, v.model) !== undefined, {
    message: 'El modelo no pertenece al catálogo del proveedor seleccionado',
    path: ['model'],
  });
export type UpdateLlmSettingDto = z.infer<typeof updateLlmSettingSchema>;

/** Origen del valor efectivo de una funcionalidad. */
export const llmSettingSourceSchema = z.enum(['org', 'global', 'default']);
export type LlmSettingSource = z.infer<typeof llmSettingSourceSchema>;

/** Config efectiva de una funcionalidad (lo que se muestra en el panel). */
export const llmFeatureConfigSchema = z.object({
  feature: llmFeatureSchema,
  label: z.string(),
  description: z.string(),
  provider: llmProviderSchema,
  model: z.string(),
  /** `default` = sin fila en BD (usa defaults de código); `global`/`org` = persistida. */
  source: llmSettingSourceSchema,
});
export type LlmFeatureConfig = z.infer<typeof llmFeatureConfigSchema>;

/** Un modelo del catálogo expuesto al frontend. */
export const llmModelOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  maxTokens: z.number().int().positive(),
  multimodal: z.boolean(),
});

/** GET /api/llm-settings — config efectiva + catálogo para poblar los selects. */
export const llmSettingsResponseSchema = z.object({
  features: z.array(llmFeatureConfigSchema),
  providers: z.array(z.object({ id: llmProviderSchema, label: z.string() })),
  catalog: z.record(llmProviderSchema, z.array(llmModelOptionSchema)),
});
export type LlmSettingsResponse = z.infer<typeof llmSettingsResponseSchema>;
