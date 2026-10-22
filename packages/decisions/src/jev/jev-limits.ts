import type { DecisionEngineLimits, ImageConstraints } from '../contracts';

/**
 * Restricciones de imagen de Jev 1.13/1.14 (docs.typesafe.ai/images.md): PNG o
 * JPEG, cada lado entre 280 y 1568 px, entre 78 400 y 2 458 624 px en total y
 * 16 MiB por imagen. Jev NO reescala: una imagen fuera de rango hace fallar toda
 * la llamada, así que el adaptador la ajusta antes (`fitImage`).
 */
export const JEV_IMAGE_CONSTRAINTS: ImageConstraints = {
  minSidePx: 280,
  maxSidePx: 1568,
  minPixels: 78_400,
  maxPixels: 2_458_624,
  maxBytes: 16 * 1024 * 1024,
};

/**
 * Lado menor al que el adaptador lleva cada imagen antes de enviarla a Jev. Es
 * el tamaño calibrado en la PoC de marcas (`analisis-omr-marcas/poc-decisions-2026-10-21`),
 * apenas sobre el mínimo de 280 px.
 */
export const JEV_IMAGE_TARGET_MIN_SIDE_PX = 300;

/** Límites de Jev (docs.typesafe.ai/models, /api, /images — jev-1.13 y 1.14). */
export const JEV_LIMITS: DecisionEngineLimits = {
  minChoiceOptions: 1,
  maxChoiceOptions: 255,
  minScoreLevels: 2,
  maxScoreLevels: 10,
  maxStatePlusQuestionTokens: 32_000,
  maxRequestTokens: 64_000,
  /** El español tokeniza peor que el inglés; preferimos rechazar de más. */
  charsPerToken: 3,
  /**
   * La doc todavía no publica cómo estimar los tokens de una imagen. En la PoC,
   * una de 1103×300 costó ~1 300: se cuentan 3 000 para no quedarse cortos.
   */
  tokensPerImage: 3_000,
  imageConstraints: JEV_IMAGE_CONSTRAINTS,
};
