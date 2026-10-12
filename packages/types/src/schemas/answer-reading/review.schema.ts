import { z } from 'zod';
import { reviewModeSchema } from './consensus.schema';

// Revisión humana (diseño §11). Las revisiones solo se AGREGAN: deshacer crea una
// fila nueva que reemplaza a la anterior (`supersededById`); nada se borra.

export const REVIEW_ACTIONS = [
  'accept',
  'edit',
  'illegible',
  'blank',
  'crossed_out',
  'mark_correct',
  'mark_incorrect',
  'undo',
] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];
export const reviewActionSchema = z.enum(REVIEW_ACTIONS);

// Acciones válidas por modo: en 'reading' se decide QUÉ dice; en 'grading', si
// la respuesta es correcta.
export const REVIEW_ACTIONS_BY_MODE = {
  reading: ['accept', 'edit', 'illegible', 'blank', 'crossed_out', 'undo'],
  grading: ['mark_correct', 'mark_incorrect', 'edit', 'undo'],
} as const satisfies Record<z.infer<typeof reviewModeSchema>, readonly ReviewAction[]>;

export const submitReviewSchema = z
  .object({
    decisionIds: z.array(z.string().uuid()).min(1).max(500),
    mode: reviewModeSchema,
    action: reviewActionSchema,
    editedLiteral: z.string().max(500).optional(),
    reason: z.string().max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const allowed: readonly ReviewAction[] = REVIEW_ACTIONS_BY_MODE[value.mode];
    if (!allowed.includes(value.action)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['action'],
        message: 'La acción no corresponde al modo de revisión',
      });
    }
    if (value.action === 'edit' && !value.editedLiteral?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['editedLiteral'],
        message: 'Para editar debes escribir la respuesta',
      });
    }
  });
export type SubmitReviewDto = z.infer<typeof submitReviewSchema>;
