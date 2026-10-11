import { z } from 'zod';
import { normalizedAnswerSchema } from './normalized-answer.schema';
import { readerSpecSchema } from './reader.schema';

// Política de consenso y resultado de la decisión (diseño §8).
// Regla central: indecidible ≠ incorrecto. Lo que no se puede decidir con certeza
// va a revisión humana y queda pendiente (final_score null), NUNCA 0.

export const AGREE_ON = ['canonical', 'scoring_outcome'] as const;
export const ON_DISAGREEMENT = ['review', 'tiebreak_reader'] as const;
export const AUTO_ACCEPT_OUTCOMES = ['correct', 'incorrect'] as const;
export type AutoAcceptOutcome = (typeof AUTO_ACCEPT_OUTCOMES)[number];

export const consensusPolicySchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    minReaders: z.number().int().min(1).max(4),
    requireDistinctFamilies: z.boolean(),
    agreeOn: z.enum(AGREE_ON),
    minConfidence: z.number().min(0).max(1),
    alternativePlausibilityFloor: z.number().min(0).max(1),
    blankByInkBelow: z.number().min(0).max(1).nullable(),
    onDisagreement: z.enum(ON_DISAGREEMENT),
    tiebreakReader: readerSpecSchema.nullable(),
    autoAccept: z.boolean(),
    autoAcceptOutcomes: z.array(z.enum(AUTO_ACCEPT_OUTCOMES)),
    auditSampleRate: z.number().min(0).max(1),
  })
  .strict();
export type ConsensusPolicy = z.infer<typeof consensusPolicySchema>;

// Política inicial decidida (D5): correctas e incorrectas se autoaceptan con
// consenso de dos familias distintas y confianza suficiente; 10 % de auditoría.
export const DEFAULT_CONSENSUS_POLICY: ConsensusPolicy = {
  id: 'short-answer-default',
  version: 1,
  minReaders: 2,
  requireDistinctFamilies: true,
  agreeOn: 'canonical',
  minConfidence: 0.85,
  alternativePlausibilityFloor: 0.2,
  blankByInkBelow: null,
  onDisagreement: 'review',
  tiebreakReader: null,
  autoAccept: true,
  autoAcceptOutcomes: ['correct', 'incorrect'],
  auditSampleRate: 0.1,
};

export const READING_OUTCOMES = [
  'auto_accepted',
  'auto_blank',
  'needs_review',
  'not_read',
] as const;
export type ReadingOutcome = (typeof READING_OUTCOMES)[number];
export const readingOutcomeSchema = z.enum(READING_OUTCOMES);

export const REVIEW_REASONS = [
  'readers_disagree',
  'low_confidence',
  'alternative_flips_outcome',
  'illegible',
  'multiple_answers',
  'crossed_out',
  'undecidable',
  'unparsed_format',
  'format_mismatch',
  'reader_failed',
  'insufficient_readers',
  'reader_requested_review',
  'policy_requires_review',
  'audit_sample',
  'rubric_item',
  'external_vision_disabled',
  'reading_disabled',
  'budget_exceeded',
  'run_limit_exceeded',
  'crop_unavailable',
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];
export const reviewReasonSchema = z.enum(REVIEW_REASONS);

// Modo de revisión que corresponde a cada motivo (decisión D8):
// 'reading'  → "¿qué escribió el alumno?", SIN mostrar la clave.
// 'grading'  → "¿esta respuesta es correcta?", CON la clave.
export const REVIEW_MODES = ['reading', 'grading'] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];
export const reviewModeSchema = z.enum(REVIEW_MODES);

export const REVIEW_MODE_BY_REASON: Record<ReviewReason, ReviewMode> = {
  readers_disagree: 'reading',
  low_confidence: 'reading',
  alternative_flips_outcome: 'reading',
  illegible: 'reading',
  multiple_answers: 'reading',
  crossed_out: 'reading',
  reader_failed: 'reading',
  insufficient_readers: 'reading',
  reader_requested_review: 'reading',
  external_vision_disabled: 'reading',
  reading_disabled: 'reading',
  budget_exceeded: 'reading',
  run_limit_exceeded: 'reading',
  crop_unavailable: 'reading',
  format_mismatch: 'reading',
  audit_sample: 'reading',
  undecidable: 'grading',
  unparsed_format: 'grading',
  policy_requires_review: 'grading',
  rubric_item: 'grading',
};

// Si hay motivos de los dos modos, primero se resuelve la lectura.
export function reviewModeFor(reasons: readonly ReviewReason[]): ReviewMode {
  return reasons.some((reason) => REVIEW_MODE_BY_REASON[reason] === 'reading')
    ? 'reading'
    : 'grading';
}

export const SCORING_OUTCOMES = ['correct', 'incorrect', 'partial', 'undecidable'] as const;
export type ScoringOutcome = (typeof SCORING_OUTCOMES)[number];
export const scoringOutcomeSchema = z.enum(SCORING_OUTCOMES);

export const consensusResultSchema = z.object({
  outcome: readingOutcomeSchema,
  value: normalizedAnswerSchema.nullable(),
  scoringOutcome: scoringOutcomeSchema.nullable(),
  reasons: z.array(reviewReasonSchema),
  reviewMode: reviewModeSchema.nullable(),
  usedReadingIds: z.array(z.string().min(1)),
  policyId: z.string().min(1),
  policyVersion: z.number().int().positive(),
});
export type ConsensusResult = z.infer<typeof consensusResultSchema>;
