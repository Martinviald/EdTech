// Re-export de los contratos Zod compartidos (packages/types). El DTO del módulo
// NO redefine schemas: la validación es la misma pieza que consume el widget web.
export {
  createFeedbackSchema,
  updateFeedbackSchema,
  feedbackQuerySchema,
  feedbackScreenshotUrlSchema,
  type CreateFeedbackDto,
  type UpdateFeedbackDto,
  type FeedbackQueryDto,
  type FeedbackScreenshotUrlDto,
} from '@soe/types';
