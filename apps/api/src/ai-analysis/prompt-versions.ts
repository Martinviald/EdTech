import { INSTRUMENT_COMPARISON_ANALYSIS_TYPE } from '@soe/types';
import { PROMPT_VERSION as ASSESSMENT_INSIGHTS_PROMPT_VERSION } from './prompts/assessment-insights.prompt';
import { PROMPT_VERSION as INSTRUMENT_COMPARISON_PROMPT_VERSION } from './prompts/instrument-comparison.prompt';
import { ITEM_INSIGHT_PROMPT_VERSION } from './prompts/item-insight.prompt';

/**
 * Versión de prompt vigente por `analysisType`.
 *
 * Existe para que la CACHÉ (`input_hash`) sepa de qué prompt salió cada análisis.
 * Sin esto, cambiar un prompt no invalida nada: `ai_analyses` sigue devolviendo la
 * fila `completed` que se generó con el prompt viejo y el cambio es invisible para
 * toda evaluación ya analizada. Se descubrió sacando la calidad del instrumento
 * (docs/diseno-limpieza-calidad-instrumento.md §3.1): la limpieza no se habría visto
 * en ningún análisis existente.
 *
 * Regla: al bumpear la versión de un prompt no hay que tocar nada más. Los análisis
 * viejos quedan en la tabla con su `prompt_version` (historial intacto) y el próximo
 * pedido, al hashear distinto, genera uno nuevo.
 */
const PROMPT_VERSION_BY_TYPE: Record<string, string> = {
  assessment_insights: ASSESSMENT_INSIGHTS_PROMPT_VERSION,
  item_insight: ITEM_INSIGHT_PROMPT_VERSION,
  [INSTRUMENT_COMPARISON_ANALYSIS_TYPE]: INSTRUMENT_COMPARISON_PROMPT_VERSION,
};

/**
 * Versión del prompt con que se produce `analysisType`.
 *
 * Un tipo desconocido devuelve el propio `analysisType` en vez de lanzar: el campo
 * es `text` a propósito (Open/Closed, tipos nuevos sin migración) y un tipo sin
 * prompt registrado igual debe poder cachear de forma estable.
 */
export function promptVersionFor(analysisType: string): string {
  return PROMPT_VERSION_BY_TYPE[analysisType] ?? analysisType;
}
