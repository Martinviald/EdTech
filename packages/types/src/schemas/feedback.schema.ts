import { z } from 'zod';
import { USER_ROLES } from '../enums';

// ─────────────────────────────────────────────────────────────────────────────
// Feedback in-app — contratos compartidos del módulo `feedback` (apps/api,
// ruta base /api/feedback) y el widget de /components/feedback.
//
// Diseño: el formulario pide TRES cosas (tipo, texto, captura opcional) y nada
// más. Todo lo demás —dónde estaba la persona, con qué rol, en qué navegador—
// lo adjunta el cliente solo. Cada campo obligatorio extra es feedback que no
// se escribe.
// ─────────────────────────────────────────────────────────────────────────────

export const FEEDBACK_TYPES = ['bug', 'idea', 'confusion'] as const;
export const feedbackTypeSchema = z.enum(FEEDBACK_TYPES);
export type FeedbackType = z.infer<typeof feedbackTypeSchema>;

/** Etiquetas de UI. En español neutro, en primera persona de quien reporta. */
export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  bug: 'Algo no funciona',
  idea: 'Idea de mejora',
  confusion: 'Me costó entender',
};

export const FEEDBACK_STATUSES = ['new', 'triaged', 'planned', 'done', 'discarded'] as const;
export const feedbackStatusSchema = z.enum(FEEDBACK_STATUSES);
export type FeedbackStatus = z.infer<typeof feedbackStatusSchema>;

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: 'Nuevo',
  triaged: 'Revisado',
  planned: 'Planificado',
  done: 'Resuelto',
  discarded: 'Descartado',
};

/**
 * Contexto capturado automáticamente. Es la parte valiosa del registro: sin esto
 * un comentario es una anécdota, con esto es un ticket reproducible.
 *
 * Todos los campos son opcionales a propósito — el contexto es best-effort y
 * jamás debe impedir que el comentario se guarde. Va a JSONB (§5.4) porque sus
 * campos varían por vista y van a crecer sin migración.
 */
export const feedbackContextSchema = z.object({
  /** Ruta de la app donde se abrió el widget, ya con query string. */
  path: z.string().max(2048).optional(),
  /** Título de la vista, para leer la lista sin decodificar URLs. */
  pageTitle: z.string().max(200).optional(),
  /** Rol ACTIVO al momento de enviar: la misma vista se ve distinta por rol. */
  activeRole: z.enum(USER_ROLES).optional(),
  userAgent: z.string().max(512).optional(),
  viewport: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .optional(),
  /** Reloj del cliente en ISO-8601; `created_at` es el del servidor. */
  clientTime: z.string().max(64).optional(),
  /** Versión de la app desplegada, para saber si un bug ya se corrigió. */
  appVersion: z.string().max(64).optional(),
});
export type FeedbackContext = z.infer<typeof feedbackContextSchema>;

/** POST /feedback — lo único que la persona escribe son `type` y `message`. */
export const createFeedbackSchema = z.object({
  type: feedbackTypeSchema,
  message: z
    .string()
    .trim()
    .min(1, 'Escribe tu comentario.')
    .max(5000, 'El comentario es demasiado largo.'),
  context: feedbackContextSchema.default({}),
  screenshotFileId: z.string().uuid().nullish(),
});
export type CreateFeedbackDto = z.infer<typeof createFeedbackSchema>;

/** PATCH /feedback/:id — triage interno. No toca lo que la persona escribió. */
export const updateFeedbackSchema = z
  .object({
    status: feedbackStatusSchema.optional(),
    internalNote: z.string().max(5000).nullish(),
  })
  .refine((v) => v.status !== undefined || v.internalNote !== undefined, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });
export type UpdateFeedbackDto = z.infer<typeof updateFeedbackSchema>;

export const feedbackQuerySchema = z.object({
  status: feedbackStatusSchema.optional(),
  type: feedbackTypeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type FeedbackQueryDto = z.infer<typeof feedbackQuerySchema>;

export interface FeedbackListItem {
  id: string;
  type: FeedbackType;
  status: FeedbackStatus;
  message: string;
  context: FeedbackContext;
  internalNote: string | null;
  screenshotUrl: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface FeedbackListResponse {
  data: FeedbackListItem[];
  total: number;
  page: number;
  limit: number;
}

/** POST /feedback/screenshot-url — presigned de S3 para la captura opcional. */
export const feedbackScreenshotUrlSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024)
    .optional(),
});
export type FeedbackScreenshotUrlDto = z.infer<typeof feedbackScreenshotUrlSchema>;
