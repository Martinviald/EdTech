import { z } from 'zod';

/**
 * Configuración de modelos de IA por funcionalidad (panel /configuracion/modelos-ia).
 *
 * Cada "funcionalidad" (`LlmFeature`) es un punto de llamada al LLM. Un
 * `platform_admin` elige, por funcionalidad, el PROVEEDOR (Gemini/Claude/OpenAI) y el
 * MODELO. La elección se persiste en la tabla `llm_settings` (global por ahora,
 * `org_id = NULL`; per-org en el futuro) y `LlmConfigService.resolve` la consulta
 * en runtime. Este archivo es la fuente ÚNICA compartida FE/BE de funcionalidades,
 * proveedores, defaults de código y validación. El catálogo de modelos y sus
 * precios vive en la tabla `llm_models` (ver `llm-models.schema.ts`).
 */

// ── Funcionalidades configurables ────────────────────────────────────────────
// Granularidad acordada: las 3 generaciones remediales (guía/práctica/plan grupal)
// se agrupan en `remedial` (self_contained, Flash). `remedial_reading` es su punto
// de llamada hermano para la generación ANCLADA a un pasaje (Opción A, Ola 2.1a):
// razona sobre el texto completo del estímulo → usa un modelo más fuerte (Pro).
// `remedial_judge` (Ola 2.1b) es el juez automático que valida las preguntas
// generadas (solve-then-check + loop de regeneración): arranca en Flash y se
// cambiará a otro proveedor por config.
export const LLM_FEATURES = [
  'assessment_analysis',
  'item_insight',
  'instrument_comparison',
  'remedial',
  'remedial_reading',
  'remedial_judge',
  'ai_tagging',
  'ai_grading',
  'assistant',
  'answer_transcription',
  'rubric_grading',
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
  remedial_reading: {
    label: 'Material Remedial — Lectura anclada',
    description:
      'Preguntas nuevas ancladas a un pasaje oficial de la evaluación (Opción A). Razona sobre el texto completo.',
  },
  remedial_judge: {
    label: 'Material Remedial — Juez de calidad',
    description:
      'Valida las preguntas remediales generadas (respondibles, clave única, factual) y gatilla su regeneración.',
  },
  ai_tagging: {
    label: 'Auto-etiquetado de ítems',
    description: 'Sugerencias de taxonomía (habilidades) para ítems del banco.',
  },
  ai_grading: {
    label: 'Corrección IA de desarrollo',
    description:
      'Puntaje sugerido para respuestas de desarrollo escaneadas (recorte de la hoja + rúbrica). Requiere modelo multimodal.',
  },
  assistant: {
    label: 'Asistente IA conversacional',
    description: 'Chat con herramientas para directivos (streaming).',
  },
  answer_transcription: {
    label: 'Lectura de respuestas abiertas',
    description:
      'Transcribe lo que el estudiante escribió a mano en una respuesta corta (recorte de la hoja escaneada). Requiere modelo multimodal.',
  },
  rubric_grading: {
    label: 'Calificación con rúbrica',
    description:
      'Propone un puntaje por criterio de rúbrica para respuestas de desarrollo escaneadas; una persona lo confirma. Requiere modelo multimodal.',
  },
};

// ── Proveedores configurables ────────────────────────────────────────────────
// Subconjunto de `LlmProviderName` (apps/api) con provider implementado y
// seleccionable hoy. Para agregar un proveedor nuevo (p. ej. `deepseek`):
//  1. Sumar su id aquí y su etiqueta en `LLM_PROVIDER_LABELS`.
//  2. Implementar `providers/<id>.provider.ts` (interfaz `LlmProvider`, incluido
//     `completeStructured`) y registrarlo en la factory `LLM_PROVIDERS` de `LlmModule`.
//  3. Declarar su API key en `LLM_PROVIDER_DEFAULTS` (apps/api/src/llm/llm.constants.ts).
//  4. Dar de alta sus modelos y precios como filas de `llm_models` (seed o panel
//     de administración del catálogo). Los modelos NO viven en código.
//
// Privacidad: el Batch API de OpenAI no es compatible con cero retención de datos
// (Zero Data Retention). No uses batch de OpenAI para datos de estudiantes si el
// contrato exige cero retención.
export const LLM_PROVIDERS = ['gemini', 'anthropic', 'openai'] as const;
export type LlmProviderId = (typeof LLM_PROVIDERS)[number];
export const llmProviderSchema = z.enum(LLM_PROVIDERS);

export const LLM_PROVIDER_LABELS: Record<LlmProviderId, string> = {
  gemini: 'Google Gemini',
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
};

// ── Modelos seleccionables ───────────────────────────────────────────────────
// El catálogo vive en la tabla `llm_models` (administrada por platform_admin vía
// /api/llm-models). El panel recibe sólo los modelos habilitados de cada proveedor.
export interface LlmModelOption {
  /** Identificador exacto del modelo en el proveedor. */
  id: string;
  /** Etiqueta legible (UI). */
  label: string;
  /** Tope de tokens de salida derivado del modelo (no editable en el panel). */
  maxTokens: number;
  /** El modelo acepta imágenes (necesario para las funcionalidades multimodales). */
  multimodal: boolean;
}

/** Tope de tokens de salida cuando el modelo no está en el catálogo. */
export const LLM_FALLBACK_MAX_TOKENS = 4096;

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
  // Generación anclada al pasaje (Opción A): razona sobre el texto → Pro por defecto.
  remedial_reading: { provider: 'gemini', model: 'gemini-2.5-pro' },
  // Juez automático (Ola 2.1b): arranca en Flash; se cambiará a otro proveedor por config.
  remedial_judge: { provider: 'gemini', model: 'gemini-2.5-flash' },
  ai_tagging: { provider: 'gemini', model: 'gemini-2.5-flash' },
  ai_grading: { provider: 'gemini', model: 'gemini-2.5-pro' },
  assistant: { provider: 'gemini', model: 'gemini-2.5-flash' },
  answer_transcription: { provider: 'anthropic', model: 'claude-haiku-5-5' },
  rubric_grading: { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
};

/** Funcionalidades que exigen un modelo multimodal (envían imágenes al LLM). */
export const MULTIMODAL_FEATURES: readonly LlmFeature[] = [
  'item_insight',
  'ai_grading',
  'answer_transcription',
  'rubric_grading',
];

// ── Request / Response models ────────────────────────────────────────────────

/**
 * PATCH /api/llm-settings/:feature (LLM_SETTINGS_ROLES). Sólo valida la forma: que
 * el modelo exista y esté habilitado para el proveedor lo valida el service contra
 * la tabla `llm_models`.
 */
export const updateLlmSettingSchema = z
  .object({
    provider: llmProviderSchema,
    model: z.string().trim().min(1).max(120),
  })
  .strict();
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

/** GET /api/llm-settings — config efectiva + modelos habilitados para poblar los selects. */
export const llmSettingsResponseSchema = z.object({
  features: z.array(llmFeatureConfigSchema),
  providers: z.array(
    z.object({
      id: llmProviderSchema,
      label: z.string(),
      /** `false` si el proveedor no tiene API key configurada en el servidor. */
      available: z.boolean(),
    }),
  ),
  catalog: z.record(llmProviderSchema, z.array(llmModelOptionSchema)),
});
export type LlmSettingsResponse = z.infer<typeof llmSettingsResponseSchema>;
