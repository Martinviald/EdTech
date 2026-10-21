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
 */
const FALLBACK_MODEL_PRICING_PER_MTOK: ReadonlyArray<{
  prefix: string;
  inputUsd: number;
  outputUsd: number;
}> = [
  // Anthropic Claude.
  { prefix: 'claude-sonnet-5', inputUsd: 2, outputUsd: 10 },
  { prefix: 'claude-sonnet-4-6', inputUsd: 3, outputUsd: 15 },
  { prefix: 'claude-sonnet', inputUsd: 3, outputUsd: 15 },
  { prefix: 'claude-opus-5-5', inputUsd: 4, outputUsd: 20 },
  { prefix: 'claude-opus-5', inputUsd: 5, outputUsd: 25 },
  { prefix: 'claude-opus-4-8', inputUsd: 5, outputUsd: 25 },
  { prefix: 'claude-opus-4-7', inputUsd: 5, outputUsd: 25 },
  { prefix: 'claude-opus-4-6', inputUsd: 5, outputUsd: 25 },
  { prefix: 'claude-opus', inputUsd: 15, outputUsd: 75 },
  { prefix: 'claude-haiku-5', inputUsd: 0.1, outputUsd: 0.5 },
  { prefix: 'claude-haiku-4-5', inputUsd: 1, outputUsd: 5 },
  { prefix: 'claude-haiku', inputUsd: 0.8, outputUsd: 4 },
  { prefix: 'claude-3-5-haiku', inputUsd: 0.8, outputUsd: 4 },
  { prefix: 'claude-3-haiku', inputUsd: 0.25, outputUsd: 1.25 },
  // Google Gemini — variantes específicas primero (ver nota de orden arriba).
  { prefix: 'gemini-3.8-flash', inputUsd: 1.5, outputUsd: 7.5 },
  { prefix: 'gemini-3.6-flash', inputUsd: 1.5, outputUsd: 7.5 },
  { prefix: 'gemini-3.5-flash-lite', inputUsd: 0.3, outputUsd: 2.5 },
  { prefix: 'gemini-3.1-flash-lite', inputUsd: 0.25, outputUsd: 1.5 },
  { prefix: 'gemini-2.5-flash-lite', inputUsd: 0.1, outputUsd: 0.4 },
  { prefix: 'gemini-2.5-flash', inputUsd: 0.3, outputUsd: 2.5 },
  { prefix: 'gemini-2.5-pro', inputUsd: 1.25, outputUsd: 10 },
  { prefix: 'gemini-2.0-flash', inputUsd: 0.1, outputUsd: 0.4 },
  { prefix: 'gemini-1.5-flash', inputUsd: 0.075, outputUsd: 0.3 },
  { prefix: 'gemini-1.5-pro', inputUsd: 1.25, outputUsd: 5 },
  { prefix: 'gpt-6-luna', inputUsd: 0.1, outputUsd: 0 },
  { prefix: 'gpt-6.1-sol', inputUsd: 2, outputUsd: 10 },
  { prefix: 'jev-', inputUsd: 0.042, outputUsd: 0 },
];

export interface LlmModelTariff {
  inputUsdPerMtok: number;
  outputUsdPerMtok: number;
  cachedInputUsdPerMtok: number | null;
}

let catalogTariffs: ReadonlyMap<string, LlmModelTariff> = new Map();

export function setCatalogTariffs(tariffs: ReadonlyMap<string, LlmModelTariff>): void {
  catalogTariffs = tariffs;
}

function resolveTariff(model: string): LlmModelTariff | null {
  const fromCatalog = catalogTariffs.get(model);
  if (fromCatalog) return fromCatalog;
  const fallback = FALLBACK_MODEL_PRICING_PER_MTOK.find((t) => model.startsWith(t.prefix));
  if (!fallback) return null;
  return {
    inputUsdPerMtok: fallback.inputUsd,
    outputUsdPerMtok: fallback.outputUsd,
    cachedInputUsdPerMtok: null,
  };
}

export function estimateLlmCostUsd(
  model: string | null | undefined,
  usage: LlmUsage | null | undefined,
  decimals = 6,
): string | null {
  if (!model || !usage) return null;
  const tariff = resolveTariff(model);
  if (!tariff) return null;

  const cachedInputTokens = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const freshInputTokens = usage.inputTokens - cachedInputTokens;
  const cachedInputUsdPerMtok = tariff.cachedInputUsdPerMtok ?? tariff.inputUsdPerMtok;

  const cost =
    (freshInputTokens / 1_000_000) * tariff.inputUsdPerMtok +
    (cachedInputTokens / 1_000_000) * cachedInputUsdPerMtok +
    (usage.outputTokens / 1_000_000) * tariff.outputUsdPerMtok;

  return cost.toFixed(decimals);
}
