// Re-export de los contratos Zod compartidos (packages/types). El DTO del módulo
// NO redefine schemas: la validación es la misma pieza que consume el widget web.
export {
  adminUpdateFeedbackSchema,
  createFeedbackSchema,
  feedbackAdminQuerySchema,
  updateFeedbackSchema,
  feedbackQuerySchema,
  feedbackScreenshotUrlSchema,
  type AdminUpdateFeedbackDto,
  type CreateFeedbackDto,
  type FeedbackAdminQueryDto,
  type UpdateFeedbackDto,
  type FeedbackQueryDto,
  type FeedbackScreenshotUrlDto,
} from '@soe/types';
