import type { DecisionEngineLimits } from '../contracts';

/** Límites de Jev (docs.typesafe.ai/models, /api — jev-1.13). Jev no acepta imágenes. */
export const JEV_LIMITS: DecisionEngineLimits = {
  minChoiceOptions: 1,
  maxChoiceOptions: 255,
  minScoreLevels: 2,
  maxScoreLevels: 10,
  maxStatePlusQuestionTokens: 32_000,
  maxRequestTokens: 64_000,
  /** El español tokeniza peor que el inglés; preferimos rechazar de más. */
  charsPerToken: 3,
  tokensPerImage: 0,
};
