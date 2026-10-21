import type { DecisionEngineLimits } from '../contracts';

/**
 * Límites de OpenAI Decisions (`gpt-6-luna`). La guía no los publica: salen del
 * spike del 2026-10-21 (`docs/plan-integracion-openai-decisions.md`, Fase 0).
 *
 * - `choice`: el servidor exige entre 2 y 255 opciones (400 `array_below_min_length`
 *   / `array_above_max_length`).
 * - `score`: entre 2 y 10 niveles (mismos códigos).
 * - Contexto: aceptó 900 163 tokens de entrada y rechazó ~1,2 M con
 *   "Decision input exceeds the token limit." No distingue estado + pregunta más
 *   larga de estado + todas: ambos topes quedan iguales y bajo lo observado.
 * - Imágenes: un PNG de 480×320 costó ~150 tokens y uno de 2800×2800 (23 MB), ~7 750.
 *   Se cuentan 8 000 por imagen para no depender del tamaño.
 */
export const OPENAI_LIMITS: DecisionEngineLimits = {
  minChoiceOptions: 2,
  maxChoiceOptions: 255,
  minScoreLevels: 2,
  maxScoreLevels: 10,
  maxStatePlusQuestionTokens: 900_000,
  maxRequestTokens: 900_000,
  charsPerToken: 3,
  tokensPerImage: 8_000,
};
