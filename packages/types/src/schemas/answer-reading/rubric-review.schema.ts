import { z } from 'zod';
import { responseFormatKindSchema } from './response-format.schema';

// Aprobación docente de la calificación con rúbrica (F11b, diseño §11.3).
// La IA propone un nivel (`responses.ai_score`); el docente siempre aprueba con
// una acción explícita y su nivel queda en `human_score`.
//
// Rutas (SHEET_REVIEW_ROLES, igual que la cola de F8):
//   GET  /answer-reading/rubric-queue                       → rubricQueuePageSchema
//   GET  /answer-reading/rubric-queue/:decisionId           → rubricReviewDetailSchema
//   POST /answer-reading/rubric-approvals                   → rubricApprovalSchema
//   POST /answer-reading/rubric-approvals/accept-proposals  → acceptRubricProposalsSchema
// Las dos aprobaciones responden rubricApprovalResultSchema. Cada aprobación
// escribe una fila en `answer_reviews` (modo 'grading', `mark_correct` si el
// nivel da el puntaje completo y `mark_incorrect` si no, con el código del nivel
// en `edited_literal`), así que se deshace con POST /answer-reading/reviews/undo.
//
// Aprobación por lote: `acceptProposals` acepta, para cada respuesta, el nivel
// que propuso la IA para ESA lectura. No hay "un nivel para todas": eso sería
// calificar sin mirar. Las que no tienen propuesta vigente se informan en
// `skipped` con motivo `no_proposal`.
//
// Corrección ciega: nada de esto trae nombre ni RUT del alumno.

export const rubricQueueQuerySchema = z
  .object({
    assessmentId: z.string().uuid().optional(),
    batchId: z.string().uuid().optional(),
    itemId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine((query) => Boolean(query.assessmentId) !== Boolean(query.batchId), {
    message: 'Indica una evaluación o un lote, no ambos',
  });
export type RubricQueueQuery = z.infer<typeof rubricQueueQuerySchema>;

export const rubricLevelOptionSchema = z.object({
  code: z.string(),
  label: z.string().nullable(),
  descriptor: z.string().nullable(),
  creditFraction: z.number().min(0).max(1),
  score: z.number().nonnegative(),
});
export type RubricLevelOption = z.infer<typeof rubricLevelOptionSchema>;

export const rubricAiProposalSchema = z.object({
  levelCode: z.string(),
  score: z.number().nonnegative().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  rationale: z.string().nullable(),
  evidenceQuotes: z.array(z.string()),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
});
export type RubricAiProposal = z.infer<typeof rubricAiProposalSchema>;

export const rubricApprovalStateSchema = z.object({
  reviewId: z.string().uuid(),
  levelCode: z.string(),
  reviewerName: z.string().nullable(),
  approvedAt: z.string(),
});
export type RubricApprovalState = z.infer<typeof rubricApprovalStateSchema>;

// `awaitingConfirmation`: la respuesta todavía no está vinculada a un alumno
// (el lote no se confirmó). No se puede aprobar hasta confirmar.
export const rubricQueueEntrySchema = z.object({
  decisionId: z.string().uuid(),
  itemId: z.string().uuid(),
  printedNumber: z.string(),
  transcription: z.string().nullable(),
  cropUrl: z.string().url().nullable(),
  proposal: rubricAiProposalSchema.pick({ levelCode: true, confidence: true }).nullable(),
  awaitingConfirmation: z.boolean(),
});
export type RubricQueueEntry = z.infer<typeof rubricQueueEntrySchema>;

export const rubricQueuePageSchema = z.object({
  data: z.array(rubricQueueEntrySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
});
export type RubricQueuePage = z.infer<typeof rubricQueuePageSchema>;

export const rubricReviewDetailSchema = z.object({
  decisionId: z.string().uuid(),
  itemId: z.string().uuid(),
  printedNumber: z.string(),
  formatKind: responseFormatKindSchema.nullable(),
  stem: z.string().nullable(),
  transcription: z.string().nullable(),
  cropUrl: z.string().url().nullable(),
  maxScore: z.number().nonnegative(),
  levels: z.array(rubricLevelOptionSchema),
  proposal: rubricAiProposalSchema.nullable(),
  approval: rubricApprovalStateSchema.nullable(),
  pending: z.boolean(),
  awaitingConfirmation: z.boolean(),
});
export type RubricReviewDetail = z.infer<typeof rubricReviewDetailSchema>;

export const rubricApprovalSchema = z
  .object({
    decisionId: z.string().uuid(),
    levelCode: z.string().trim().min(1).max(20),
    reason: z.string().max(500).optional(),
  })
  .strict();
export type RubricApprovalDto = z.infer<typeof rubricApprovalSchema>;

export const acceptRubricProposalsSchema = z
  .object({
    acceptAiProposals: z.array(z.string().uuid()).min(1).max(100),
  })
  .strict();
export type AcceptRubricProposalsDto = z.infer<typeof acceptRubricProposalsSchema>;

export const RUBRIC_APPROVAL_SKIP_REASONS = ['no_proposal', 'human_scored', 'not_applied'] as const;
export type RubricApprovalSkipReason = (typeof RUBRIC_APPROVAL_SKIP_REASONS)[number];

export const rubricApprovalResultSchema = z.object({
  reviewIds: z.array(z.string().uuid()),
  approvedDecisionIds: z.array(z.string().uuid()),
  skipped: z.array(
    z.object({
      decisionId: z.string().uuid(),
      reason: z.enum(RUBRIC_APPROVAL_SKIP_REASONS),
    }),
  ),
});
export type RubricApprovalResult = z.infer<typeof rubricApprovalResultSchema>;
