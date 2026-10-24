import { z } from 'zod';

/**
 * Espacio de respuestas válidas de un ítem, derivado de sus opciones y nunca de
 * la clave. La extracción solo puede devolver valores dentro de este espacio;
 * `open` deja pasar cualquier valor que cumpla el formato.
 */
export const matchingCodeSchema = z
  .object({
    code: z.string().min(1),
    column: z.string().min(1),
    index: z.string().min(1),
    text: z.string().min(1).nullable(),
  })
  .strict();
export type MatchingCode = z.infer<typeof matchingCodeSchema>;

export const answerOptionSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1).nullable(),
  })
  .strict();
export type AnswerOption = z.infer<typeof answerOptionSchema>;

export const answerSpaceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('open') }).strict(),
  z.object({ kind: z.literal('matching'), codes: z.array(matchingCodeSchema).min(1) }).strict(),
  z
    .object({
      kind: z.literal('option_set'),
      options: z.array(answerOptionSchema).min(1),
      ordered: z.boolean(),
    })
    .strict(),
]);
export type AnswerSpace = z.infer<typeof answerSpaceSchema>;
