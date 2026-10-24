import { z } from 'zod';

/**
 * Lo que entrega cada lector con `transcribe.interpret@n`, ya mapeado desde el
 * JSON del modelo (literal / estado / respuesta / candidatos / confianza). El
 * lector no ve la clave y no calcula: `answer` es lo que el alumno quiso
 * responder y `literal` lo que está escrito.
 */
export const INTERPRETED_READING_STATES = ['answered', 'ambiguous', 'blank', 'illegible'] as const;
export type InterpretedReadingState = (typeof INTERPRETED_READING_STATES)[number];

export const interpretedReadingSchema = z.object({
  literal: z.string(),
  state: z.enum(INTERPRETED_READING_STATES),
  answer: z.string(),
  candidates: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
export type InterpretedReading = z.infer<typeof interpretedReadingSchema>;
