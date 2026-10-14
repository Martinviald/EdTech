import { z } from 'zod';

// Salida del auditor de lectura. Revisa una transcripción candidata buscando por qué podría
// estar mal, sin la clave ni las otras lecturas. Solo un `approve` con confianza suficiente
// autoacepta; un `reject` o una falla dejan la casilla en revisión. El orden pide primero la
// comparación carácter por carácter (`notes`) y los caracteres dudosos, y recién después el
// veredicto.

export const READING_AUDIT_OUTPUT_KEYS = [
  'notes',
  'suspiciousCharacters',
  'verdict',
  'confidence',
] as const;
export type ReadingAuditOutputKey = (typeof READING_AUDIT_OUTPUT_KEYS)[number];

export const READING_AUDIT_VERDICTS = ['approve', 'reject'] as const;
export type ReadingAuditVerdict = (typeof READING_AUDIT_VERDICTS)[number];

export const readingAuditOutputSchema = z.object({
  notes: z.string(),
  suspiciousCharacters: z.array(z.string()),
  verdict: z.enum(READING_AUDIT_VERDICTS),
  confidence: z.number().min(0).max(1),
});
export type ReadingAuditOutput = z.infer<typeof readingAuditOutputSchema>;
