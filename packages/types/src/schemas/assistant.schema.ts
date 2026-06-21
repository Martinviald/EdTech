import { z } from 'zod';

// ── E21 — Asistente IA Conversacional ────────────────────────────────────────
// Contrato compartido api↔web de las conversaciones del asistente. El loop de
// tool-use vive en apps/api (LlmAgentService); aquí solo el modelo de datos
// expuesto: conversaciones, mensajes y trazas de tools (auditoría + UI).

/**
 * Rol de un mensaje persistido en la conversación. Solo `user`/`assistant` se
 * exponen al frontend; los bloques internos de tool-use/tool-result NO se
 * persisten como mensajes — su traza va en `toolCalls` del turno del asistente.
 */
export const ASSISTANT_MESSAGE_ROLES = ['user', 'assistant'] as const;
export type AssistantMessageRole = (typeof ASSISTANT_MESSAGE_ROLES)[number];
export const assistantMessageRoleSchema = z.enum(ASSISTANT_MESSAGE_ROLES);

/**
 * Traza de una tool ejecutada en un turno del asistente. Sirve a la auditoría
 * (qué datos vio el modelo) y a la UI ("consultando datos…"). `input` se guarda
 * tal cual lo pidió el modelo; el `content`/resultado completo NO se persiste
 * aquí (puede ser grande) — basta la referencia para reproducir.
 */
export const assistantToolCallSchema = z.object({
  /** Nombre de la tool (p. ej. `get_heatmap`). */
  name: z.string(),
  /** Argumentos con que el modelo invocó la tool. */
  input: z.record(z.unknown()),
  /** `true` si la tool falló. */
  isError: z.boolean(),
});
export type AssistantToolCall = z.infer<typeof assistantToolCallSchema>;

/** Mensaje de una conversación (response model). */
export const assistantMessageModelSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: assistantMessageRoleSchema,
  /** Texto del mensaje (markdown en respuestas del asistente). */
  content: z.string(),
  /** Trazas de tools ejecutadas en este turno (vacío para mensajes del usuario). */
  toolCalls: z.array(assistantToolCallSchema),
  createdAt: z.string().datetime(),
});
export type AssistantMessageModel = z.infer<typeof assistantMessageModelSchema>;

/** Conversación (response model, sin mensajes — para listados). */
export const assistantConversationModelSchema = z.object({
  id: z.string().uuid(),
  /** Título autogenerado del primer mensaje, o null si aún no se fija. */
  title: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AssistantConversationModel = z.infer<
  typeof assistantConversationModelSchema
>;

/** Conversación con su historial de mensajes (detalle). */
export const assistantConversationDetailSchema =
  assistantConversationModelSchema.extend({
    messages: z.array(assistantMessageModelSchema),
  });
export type AssistantConversationDetail = z.infer<
  typeof assistantConversationDetailSchema
>;

/** POST /assistant/conversations */
export const createAssistantConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});
export type CreateAssistantConversationDto = z.infer<
  typeof createAssistantConversationSchema
>;

/**
 * POST /assistant/conversations/:id/messages (respuesta vía stream SSE).
 *
 * `studentRefs` son UUIDs de alumnos mencionados con el selector `@` (PII opción
 * B, §4.4 de la planificación): el cliente resuelve nombre→UUID, de modo que el
 * NOMBRE nunca viaja al LLM — solo el UUID, que es un pseudónimo opaco. El
 * backend valida que esos alumnos pertenezcan al scope del usuario.
 */
export const sendAssistantMessageSchema = z.object({
  content: z.string().min(1).max(4000),
  studentRefs: z.array(z.string().uuid()).max(20).optional(),
});
export type SendAssistantMessageDto = z.infer<
  typeof sendAssistantMessageSchema
>;

/** GET /assistant/conversations (paginada). */
export const assistantConversationListResponseSchema = z.object({
  data: z.array(assistantConversationModelSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export type AssistantConversationListResponse = z.infer<
  typeof assistantConversationListResponseSchema
>;
