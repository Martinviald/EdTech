import type { LlmUsage } from './llm.types';

/**
 * Tarifas de referencia (USD por 1.000.000 de tokens) por modelo, para estimar el
 * costo de cada llamada al LLM con fines de OBSERVABILIDAD (no de facturación
 * exacta). Son precios de lista aproximados; ajustar si cambian. Claves por
 * PREFIJO de modelo para tolerar sufijos de versión/fecha (p. ej.
 * `claude-sonnet-4-20250514`, `gemini-2.5-flash-preview`).
 *
 * ⚠️ El orden importa: `find` devuelve el primer prefijo que haga `startsWith`,
 * así que las variantes más específicas (`-lite`, `-pro`) van ANTES que el prefijo
 * más corto que las contendría (`gemini-2.5-flash` contiene a `gemini-2.5-flash-lite`).
 *
 * Fuente única de verdad de costos LLM: la usan el asistente conversacional
 * (`assistant.service`), el informe IA (`ai-analysis.runner`) y los generadores
 * remediales (`remedial/generators/*`). No duplicar tarifas fuera de aquí (DRY).
 */
const MODEL_PRICING_PER_MTOK: ReadonlyArray<{
  prefix: string;
  inputUsd: number;
  outputUsd: number;
}> = [
  // Anthropic Claude.
  { prefix: 'claude-sonnet', inputUsd: 3, outputUsd: 15 },
  { prefix: 'claude-opus', inputUsd: 15, outputUsd: 75 },
  { prefix: 'claude-haiku', inputUsd: 0.8, outputUsd: 4 },
  { prefix: 'claude-3-5-haiku', inputUsd: 0.8, outputUsd: 4 },
  { prefix: 'claude-3-haiku', inputUsd: 0.25, outputUsd: 1.25 },
  // Google Gemini — variantes específicas primero (ver nota de orden arriba).
  { prefix: 'gemini-2.5-flash-lite', inputUsd: 0.1, outputUsd: 0.4 },
  { prefix: 'gemini-2.5-flash', inputUsd: 0.3, outputUsd: 2.5 },
  { prefix: 'gemini-2.5-pro', inputUsd: 1.25, outputUsd: 10 },
  { prefix: 'gemini-2.0-flash', inputUsd: 0.1, outputUsd: 0.4 },
  { prefix: 'gemini-1.5-flash', inputUsd: 0.075, outputUsd: 0.3 },
  { prefix: 'gemini-1.5-pro', inputUsd: 1.25, outputUsd: 5 },
];

/**
 * Estima el costo en USD de una llamada al LLM a partir del modelo y el uso de
 * tokens. Devuelve un string decimal (6 decimales) listo para la columna
 * `cost_usd` (`decimal(10,6)`), o `null` si el modelo es desconocido o no hay uso
 * de tokens: NO inventamos una tarifa — el costo queda sin registrar antes que
 * guardar un número falso.
 */
export function estimateLlmCostUsd(
  model: string | null | undefined,
  usage: LlmUsage | null | undefined,
): string | null {
  if (!model || !usage) return null;
  const tariff = MODEL_PRICING_PER_MTOK.find((t) => model.startsWith(t.prefix));
  if (!tariff) return null;

  const cost =
    (usage.inputTokens / 1_000_000) * tariff.inputUsd +
    (usage.outputTokens / 1_000_000) * tariff.outputUsd;

  return cost.toFixed(6);
}
