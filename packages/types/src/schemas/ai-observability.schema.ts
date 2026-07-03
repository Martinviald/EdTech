import { z } from 'zod';

// ── F2 S5 — H19.25 Observabilidad de costo/latencia IA ───────────────────────
// Panel de costo/tokens/latencia por org, agregado desde `ai_analyses` y
// `remedial_materials` (ambas con cost_usd, tokens, model, status, timestamps).
// Lectura sólo de DATOS YA PERSISTIDOS — no llama al LLM. Todas las queries del
// service corren dentro de withOrgContext (ambas tablas están bajo RLS).

/** Origen de un gasto IA. */
export const aiCostSourceSchema = z.enum(['ai_analysis', 'remedial']);
export type AiCostSource = z.infer<typeof aiCostSourceSchema>;

/**
 * Un bucket agregado de costo (por origen, por tipo, por modelo o por estado).
 * `key` es el identificador crudo; `label` es legible para la UI.
 */
export const aiCostBucketSchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Latencia promedio (ms) entre startedAt y completedAt de los jobs completados; null si no hay datos. */
  avgLatencyMs: z.number().nonnegative().nullable(),
});
export type AiCostBucket = z.infer<typeof aiCostBucketSchema>;

/** GET /ai-observability/summary?from&to */
export const aiObservabilitySummarySchema = z.object({
  orgId: z.string().uuid(),
  /** Rango efectivo evaluado (ISO date strings). */
  from: z.string(),
  to: z.string(),
  /** Totales globales del rango. */
  totals: z.object({
    count: z.number().int().nonnegative(),
    totalCostUsd: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    avgLatencyMs: z.number().nonnegative().nullable(),
    /** Jobs que fallaron en el rango (status='failed'). */
    failedCount: z.number().int().nonnegative(),
  }),
  /** Desglose por origen (analysis vs remedial). */
  bySource: z.array(aiCostBucketSchema),
  /** Desglose por tipo de análisis / tipo de material. */
  byType: z.array(aiCostBucketSchema),
  /** Desglose por modelo LLM (ej. gemini-2.0-flash). */
  byModel: z.array(aiCostBucketSchema),
});
export type AiObservabilitySummary = z.infer<typeof aiObservabilitySummarySchema>;

/** Nivel de alerta de presupuesto. */
export const aiBudgetAlertLevelSchema = z.enum(['ok', 'warning', 'over']);
export type AiBudgetAlertLevel = z.infer<typeof aiBudgetAlertLevelSchema>;

/** GET /ai-observability/budget */
export const aiBudgetStatusSchema = z.object({
  orgId: z.string().uuid(),
  /** Mes evaluado (YYYY-MM). */
  month: z.string(),
  monthSpendUsd: z.number().nonnegative(),
  /** Tope mensual en USD (org.config.aiBudgetUsd), o null si no hay tope. */
  budgetUsd: z.number().nonnegative().nullable(),
  /** % usado del presupuesto (0-100+), null si no hay tope. */
  pctUsed: z.number().nonnegative().nullable(),
  /** 'ok' < 80% · 'warning' 80-100% · 'over' > 100%. 'ok' si no hay tope. */
  alertLevel: aiBudgetAlertLevelSchema,
});
export type AiBudgetStatus = z.infer<typeof aiBudgetStatusSchema>;

/** Punto de la serie temporal de costo diario. */
export const aiCostTimeseriesPointSchema = z.object({
  /** Día (YYYY-MM-DD). */
  date: z.string(),
  costUsd: z.number().nonnegative(),
  count: z.number().int().nonnegative(),
});
export type AiCostTimeseriesPoint = z.infer<typeof aiCostTimeseriesPointSchema>;

/** GET /ai-observability/timeseries?from&to */
export const aiCostTimeseriesResponseSchema = z.object({
  orgId: z.string().uuid(),
  from: z.string(),
  to: z.string(),
  points: z.array(aiCostTimeseriesPointSchema),
});
export type AiCostTimeseriesResponse = z.infer<typeof aiCostTimeseriesResponseSchema>;
