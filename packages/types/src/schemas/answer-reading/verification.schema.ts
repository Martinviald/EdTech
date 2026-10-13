import { z } from 'zod';

// Salida del verificador de incorrectas (etapa 1 T4). Responde si lo escrito podría
// ser la respuesta correcta mal leída. Solo puede mandar a revisión: nunca acepta
// ni cambia una nota. El orden pide primero la comparación trazo por trazo
// (`notes`) y los caracteres que difieren, y recién después el veredicto.

export const VERIFICATION_OUTPUT_KEYS = [
  'notes',
  'differingCharacters',
  'couldBeKey',
  'confidence',
] as const;
export type VerificationOutputKey = (typeof VERIFICATION_OUTPUT_KEYS)[number];

export const verificationOutputSchema = z.object({
  notes: z.string(),
  differingCharacters: z.array(z.string()),
  couldBeKey: z.boolean(),
  confidence: z.number().min(0).max(1),
});
export type VerificationOutput = z.infer<typeof verificationOutputSchema>;
