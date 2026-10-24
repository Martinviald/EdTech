import { z } from 'zod';

// Salida de un lector (modelo de visión u otro transcriptor). El lector SOLO lee:
// nunca recibe la clave ni la respuesta modelo (principio 1 del diseño).
// El orden de las propiedades es parte del contrato: `characters` va ANTES de
// `literal` (es lo que subió la exactitud del prompt v2 de 48 % a 83 %).

export const READING_STATES = [
  'answered',
  'blank',
  'illegible',
  'crossed_out_only',
  'multiple_answers',
] as const;
export type ReadingState = (typeof READING_STATES)[number];
export const readingStateSchema = z.enum(READING_STATES);

export const characterAnalysisSchema = z.object({
  shape: z.string(),
  reading: z.string(),
  alternatives: z.array(z.string()),
});
export type CharacterAnalysis = z.infer<typeof characterAnalysisSchema>;

// `parts` es un mapa plano partId → texto (por ejemplo numerator/denominator,
// x/y, elements.0…). El normalizador vuelve a parsear `literal` por su cuenta y
// usa `parts` solo para detectar discrepancias.
export const transcriptionPartsSchema = z.record(z.string(), z.string()).nullable();

export const alternativeReadingSchema = z.object({
  literal: z.string(),
  parts: transcriptionPartsSchema,
  plausibility: z.number().min(0).max(1),
});
export type AlternativeReading = z.infer<typeof alternativeReadingSchema>;

export const TRANSCRIPTION_OUTPUT_KEYS = [
  'characters',
  'state',
  'literal',
  'parts',
  'alternativeReadings',
  'confidence',
  'reviewRequested',
  'notes',
] as const;

export const transcriptionOutputSchema = z.object({
  characters: z.array(characterAnalysisSchema),
  state: readingStateSchema,
  literal: z.string(),
  parts: transcriptionPartsSchema,
  alternativeReadings: z.array(alternativeReadingSchema),
  confidence: z.number().min(0).max(1),
  reviewRequested: z.boolean(),
  notes: z.string(),
});
export type TranscriptionOutput = z.infer<typeof transcriptionOutputSchema>;

export const TRANSCRIPTION_STATUSES = [
  'ok',
  'invalid_output',
  'refused',
  'truncated',
  'error',
  'timeout',
] as const;
export type TranscriptionStatus = (typeof TRANSCRIPTION_STATUSES)[number];
export const transcriptionStatusSchema = z.enum(TRANSCRIPTION_STATUSES);

export const readingUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  imageTokens: z.number().int().nonnegative().nullable(),
});
export type ReadingUsage = z.infer<typeof readingUsageSchema>;
