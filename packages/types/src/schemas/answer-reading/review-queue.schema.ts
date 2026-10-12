import { z } from 'zod';
import {
  readingOutcomeSchema,
  reviewModeSchema,
  reviewReasonSchema,
  scoringOutcomeSchema,
} from './consensus.schema';
import { responseFormatKindSchema, responseFormatSchema } from './response-format.schema';
import { readingStateSchema } from './transcription.schema';

// Contrato de la API de revisión de lecturas (F8, diseño §11). Fijado por el
// orquestador antes de construir API y UI en paralelo.
//
// Rutas (todas con SHEET_REVIEW_ROLES por ahora, decisión D1):
//   GET  /answer-reading/queue/summary  → reviewQueueSummarySchema
//   GET  /answer-reading/queue          → reviewQueuePageSchema (grupos)
//   GET  /answer-reading/decisions/:id  → reviewDecisionDetailSchema
//   POST /answer-reading/reviews        → submitReviewSchema → submitReviewResultSchema
//   POST /answer-reading/reviews/undo   → undoReviewsSchema → submitReviewResultSchema
//
// Semántica de `accept` (modo lectura): con `editedLiteral` se acepta ESA lectura
// (por ejemplo la alternativa elegida con 1..9); sin `editedLiteral` se acepta la
// propuesta del grupo (`canonical`). En modo corrección, `mark_correct` /
// `mark_incorrect` juzgan la propuesta; `edit` corrige el valor y se recalifica.
//
// Reglas de modo (D8): en modo 'reading' la respuesta NO trae la clave ni el
// resultado propuesto (correcta/incorrecta); en modo 'grading' sí.

export const reviewQueueScopeSchema = z
  .object({
    assessmentId: z.string().uuid().optional(),
    batchId: z.string().uuid().optional(),
  })
  .strict()
  .refine((scope) => Boolean(scope.assessmentId) !== Boolean(scope.batchId), {
    message: 'Indica una evaluación o un lote, no ambos',
  });
export type ReviewQueueScope = z.infer<typeof reviewQueueScopeSchema>;

export const reviewQueueQuerySchema = z
  .object({
    assessmentId: z.string().uuid().optional(),
    batchId: z.string().uuid().optional(),
    mode: reviewModeSchema.optional(),
    itemId: z.string().uuid().optional(),
    includeAudit: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine((query) => Boolean(query.assessmentId) !== Boolean(query.batchId), {
    message: 'Indica una evaluación o un lote, no ambos',
  });
export type ReviewQueueQuery = z.infer<typeof reviewQueueQuerySchema>;

export const readerReadingSummarySchema = z.object({
  readingId: z.string().uuid(),
  readerKey: z.string(),
  provider: z.string(),
  model: z.string(),
  state: readingStateSchema.nullable(),
  literal: z.string().nullable(),
  canonical: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  alternatives: z.array(z.object({ literal: z.string(), plausibility: z.number() })),
  reviewRequested: z.boolean(),
  notes: z.string().nullable(),
  status: z.string(),
});
export type ReaderReadingSummary = z.infer<typeof readerReadingSummarySchema>;

// Solo en modo 'grading'.
export const gradingContextSchema = z.object({
  acceptedAnswers: z.array(z.string()),
  unit: z.string().nullable(),
  proposedOutcome: scoringOutcomeSchema.nullable(),
  optionOutcomes: z.array(z.object({ literal: z.string(), outcome: scoringOutcomeSchema })),
});
export type GradingContext = z.infer<typeof gradingContextSchema>;

export const reviewGroupMemberSchema = z.object({
  decisionId: z.string().uuid(),
  cropUrl: z.string().url().nullable(),
  isAudit: z.boolean(),
});

// Un grupo = mismo ítem + mismo `canonical` propuesto + mismo modo. Sin nombre del
// alumno (corrección ciega, §11.2).
export const reviewQueueGroupSchema = z.object({
  groupKey: z.string(),
  itemId: z.string().uuid(),
  printedNumber: z.string(),
  formatKind: responseFormatKindSchema,
  responseFormat: responseFormatSchema,
  formatLabel: z.string(),
  mode: reviewModeSchema,
  canonical: z.string().nullable(),
  displayValue: z.string().nullable(),
  reasons: z.array(reviewReasonSchema),
  size: z.number().int().positive(),
  members: z.array(reviewGroupMemberSchema),
  readers: z.array(readerReadingSummarySchema),
  grading: gradingContextSchema.nullable(),
});
export type ReviewQueueGroup = z.infer<typeof reviewQueueGroupSchema>;

export const reviewQueuePageSchema = z.object({
  data: z.array(reviewQueueGroupSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
});
export type ReviewQueuePage = z.infer<typeof reviewQueuePageSchema>;

export const reviewQueueSummarySchema = z.object({
  pendingReading: z.number().int().nonnegative(),
  pendingGrading: z.number().int().nonnegative(),
  pendingAudit: z.number().int().nonnegative(),
  autoAccepted: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  reviewed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  byItem: z.array(
    z.object({
      itemId: z.string().uuid(),
      printedNumber: z.string(),
      formatLabel: z.string(),
      pendingReading: z.number().int().nonnegative(),
      pendingGrading: z.number().int().nonnegative(),
    }),
  ),
});
export type ReviewQueueSummary = z.infer<typeof reviewQueueSummarySchema>;

export const reviewDecisionDetailSchema = z.object({
  decisionId: z.string().uuid(),
  itemId: z.string().uuid(),
  printedNumber: z.string(),
  formatKind: responseFormatKindSchema,
  responseFormat: responseFormatSchema,
  formatLabel: z.string(),
  outcome: readingOutcomeSchema,
  mode: reviewModeSchema.nullable(),
  reasons: z.array(reviewReasonSchema),
  canonical: z.string().nullable(),
  displayValue: z.string().nullable(),
  cropUrl: z.string().url().nullable(),
  readers: z.array(readerReadingSummarySchema),
  grading: gradingContextSchema.nullable(),
  history: z.array(
    z.object({
      reviewId: z.string().uuid(),
      action: z.string(),
      editedLiteral: z.string().nullable(),
      reviewerName: z.string().nullable(),
      createdAt: z.string(),
      superseded: z.boolean(),
    }),
  ),
});
export type ReviewDecisionDetail = z.infer<typeof reviewDecisionDetailSchema>;

export const submitReviewResultSchema = z.object({
  reviewIds: z.array(z.string().uuid()),
  appliedDecisionIds: z.array(z.string().uuid()),
  skippedHumanScored: z.array(z.string().uuid()),
  pendingConsolidation: z.array(z.string().uuid()),
});
export type SubmitReviewResult = z.infer<typeof submitReviewResultSchema>;

export const undoReviewsSchema = z
  .object({ reviewIds: z.array(z.string().uuid()).min(1).max(500) })
  .strict();
export type UndoReviewsDto = z.infer<typeof undoReviewsSchema>;
