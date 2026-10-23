import { z } from 'zod';
import { normalizedAnswerSchema } from './normalized-answer.schema';
import { VISION_PROVIDERS, readerSpecSchema } from './reader.schema';

// Política de consenso y resultado de la decisión (diseño §8).
// `incorrectVerifier` (opcional, etapa 1 T4): lector con un prompt de propósito
// `verification` que revisa cada incorrecta que se iba a autoaceptar y puede
// mandarla a revisión (`verifier_flagged` si duda, `verifier_failed` si no pudo
// revisar). Ambos se revisan como lectura, sin clave a la vista ni corrección
// preseleccionada. Nunca acepta ni cambia una nota.
// `tiebreakOn` y `tiebreakAgreeWith` (opcionales, escalamiento): sin ellos el desempate
// solo actúa ante `readers_disagree` y se suma al grupo de las primarias (comportamiento
// original). Con `tiebreakOn`, el lector de desempate se llama ante cualquiera de esos
// motivos de lectura y confirma de forma independiente: la casilla se autoacepta solo si su
// lectura (que debe superar su propio umbral y no pedir revisión) coincide con la de una
// primaria contestada, que con `other_provider` debe ser de otro proveedor. Lo confirmado
// sigue pasando por la corrección, la política, la auditoría y el verificador.
// `readingAuditor` (opcional, auditor de lectura): si la casilla, después del consenso y del
// escalamiento, sigue en revisión solo por motivos de lectura (`READING_AUDIT_REASONS`), un
// lector con un prompt de propósito `reading_audit` revisa una transcripción candidata (la
// canónica en que coinciden dos lectores o, si ninguna coincide, la contestada de mayor
// confianza) sin ver la clave ni las otras lecturas. Solo si aprueba con confianza ≥
// `minConfidence` la casilla se autoacepta, y lo aceptado sigue pasando por la corrección, la
// política, la auditoría y el verificador. Si rechaza o falla, quedan los motivos originales.
// Regla central: indecidible ≠ incorrecto. Lo que no se puede decidir con certeza
// va a revisión humana y queda pendiente (final_score null), NUNCA 0.

export const AGREE_ON = ['canonical', 'scoring_outcome'] as const;
export const ON_DISAGREEMENT = ['review', 'tiebreak_reader'] as const;
export const TIEBREAK_TRIGGERS = [
  'readers_disagree',
  'low_confidence',
  'reader_requested_review',
] as const;
export type TiebreakTrigger = (typeof TIEBREAK_TRIGGERS)[number];
export const TIEBREAK_AGREE_WITH = ['any', 'other_provider'] as const;
export type TiebreakAgreeWith = (typeof TIEBREAK_AGREE_WITH)[number];
export const READING_AUDIT_REASONS = [
  'readers_disagree',
  'low_confidence',
  'reader_requested_review',
] as const;
export type ReadingAuditReason = (typeof READING_AUDIT_REASONS)[number];
export const READING_AUDIT_CANDIDATES = ['agreement_or_top'] as const;
export type ReadingAuditCandidate = (typeof READING_AUDIT_CANDIDATES)[number];
export const readingAuditorSchema = z
  .object({
    reader: readerSpecSchema.refine((reader) => reader.minConfidence === undefined, {
      message: 'El umbral del auditor va en readingAuditor.minConfidence, no en su lector',
    }),
    minConfidence: z.number().min(0).max(1),
    candidate: z.enum(READING_AUDIT_CANDIDATES),
  })
  .strict();
export type ReadingAuditor = z.infer<typeof readingAuditorSchema>;
// Modo de lectura: `literal` transcribe y normaliza; `interpreted` pide al lector la
// respuesta que el alumno quiso dar y la verifica en código (diseño v5).
export const READ_MODES = ['literal', 'interpreted'] as const;
export type ReadMode = (typeof READ_MODES)[number];

// Desempate con el motor de decisiones (función `answer_reading_tiebreak`): elige entre
// las respuestas de los lectores y solo vale si coincide con el lector de `agreeWithProvider`.
export const decisionTiebreakSchema = z
  .object({
    minConfidence: z.number().min(0).max(1),
    agreeWithProvider: z.enum(VISION_PROVIDERS),
  })
  .strict();
export type DecisionTiebreak = z.infer<typeof decisionTiebreakSchema>;

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
    tiebreakOn: z.array(z.enum(TIEBREAK_TRIGGERS)).min(1).optional(),
    tiebreakAgreeWith: z.enum(TIEBREAK_AGREE_WITH).optional(),
    incorrectVerifier: readerSpecSchema.optional(),
    readingAuditor: readingAuditorSchema.optional(),
    readMode: z.enum(READ_MODES).optional(),
    decisionTiebreak: decisionTiebreakSchema.optional(),
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
  'verifier_flagged',
  'verifier_failed',
  'scoring_changed',
  'answer_out_of_space',
  'answer_not_derivable',
  'blank_unverified',
  'selection_incorrect',
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
  verifier_flagged: 'reading',
  verifier_failed: 'reading',
  scoring_changed: 'reading',
  answer_out_of_space: 'reading',
  answer_not_derivable: 'reading',
  blank_unverified: 'reading',
  selection_incorrect: 'reading',
  undecidable: 'grading',
  unparsed_format: 'grading',
  policy_requires_review: 'grading',
  rubric_item: 'grading',
};

export const VERIFIER_REVIEW_REASONS: readonly ReviewReason[] = [
  'verifier_flagged',
  'verifier_failed',
];

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
