import { z } from 'zod';
import {
  decisionEngineIdSchema,
  decisionFeatureSchema,
  pairThresholdsSchema,
} from './decisions.schema';
import type { MarkReviewDecision } from './sheet-scanning.schema';

// ── Desambiguación de marcas de burbuja con IA ───────────────────────────────
// Ver docs/diseno-desambiguacion-marcas-ia.md y su complemento .contratos.md.
// Dos motores (Jev y OpenAI) responden la misma pregunta sobre el recorte de una
// marca dudosa; `pairConsensus` (@soe/decisions) decide si se aplica sola o va a
// revisión. Lo que aquí se fija es lo que se PERSISTE en sheet_scan_marks.ai_resolution
// y lo que comparten la API, las métricas y la calibración.

export const MARK_DISAMBIGUATION_DECISION_VERSION = 'mark-disambiguation-v1' as const;

/** Id de la única pregunta (y clave de los umbrales en decision_settings.thresholds). */
export const MARK_DISAMBIGUATION_QUESTION_ID = 'respuesta' as const;

/** Respuestas especiales, además de los `value` de las burbujas. Son strings. */
export const MARK_ANSWER_BLANK = 'blank' as const;
export const MARK_ANSWER_NULL = 'null' as const;

/** Un slot de `decision_settings` por motor. El motor A del combinador es Jev; el B, OpenAI. */
export const MARK_DISAMBIGUATION_FEATURES = {
  jev: 'mark_disambiguation_jev',
  openai: 'mark_disambiguation_openai',
} as const;

/** Mismos valores que `PairVerdict` de @soe/decisions (el paquete de tipos no depende de él). */
export const PAIR_VERDICTS = [
  'agree',
  'solo_a',
  'solo_b',
  'low_agreement',
  'conflict',
  'engine_failed',
] as const;

/**
 * Veredicto persistido. Además de los del combinador: `audit_sample` (automática que
 * volvió a revisión ciega), `vetoed` (veto de dominio) y `no_thresholds` (sombra sin
 * umbrales configurados).
 */
export const MARK_AI_VERDICTS = [
  ...PAIR_VERDICTS,
  'audit_sample',
  'vetoed',
  'no_thresholds',
] as const;
export type MarkAiVerdict = (typeof MARK_AI_VERDICTS)[number];

export const markAiEngineResultSchema = z
  .object({
    feature: decisionFeatureSchema,
    engine: decisionEngineIdSchema,
    model: z.string().nullable(),
    choice: z.string().nullable(),
    confidence: z.number().nullable(),
    errorCode: z.string().nullable(),
  })
  .strict();
export type MarkAiEngineResult = z.infer<typeof markAiEngineResultSchema>;

export const markAiResolutionSchema = z
  .object({
    version: z.literal(MARK_DISAMBIGUATION_DECISION_VERSION),
    mode: z.enum(['shadow', 'live']),
    verdict: z.enum(MARK_AI_VERDICTS),
    route: z.enum(['auto', 'review']),
    value: z.string().nullable(),
    applied: z.boolean(),
    engines: z.array(markAiEngineResultSchema),
    thresholds: z
      .object({
        jev: pairThresholdsSchema.nullable(),
        openai: pairThresholdsSchema.nullable(),
      })
      .strict(),
    decidedAt: z.string(),
  })
  .strict();
export type MarkAiResolution = z.infer<typeof markAiResolutionSchema>;

/**
 * Traducción de la respuesta de la IA a la decisión de la marca (la única copia):
 * opción X → `option`/X; `blank` → `blank`/null; `null` → `annulled`/null.
 */
export function markAnswerToReview(value: string): {
  reviewDecision: MarkReviewDecision;
  reviewedValue: string | null;
} {
  if (value === MARK_ANSWER_BLANK) return { reviewDecision: 'blank', reviewedValue: null };
  if (value === MARK_ANSWER_NULL) return { reviewDecision: 'annulled', reviewedValue: null };
  return { reviewDecision: 'option', reviewedValue: value };
}

/** Inversa de `markAnswerToReview`: la respuesta equivalente a una decisión registrada. */
export function reviewToMarkAnswer(
  decision: MarkReviewDecision | null,
  reviewedValue: string | null,
): string | null {
  if (decision === 'blank') return MARK_ANSWER_BLANK;
  if (decision === 'annulled') return MARK_ANSWER_NULL;
  if (decision === 'option') return reviewedValue;
  return null;
}
