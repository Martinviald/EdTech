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
export type AssistantConversationModel = z.infer<typeof assistantConversationModelSchema>;

/** Conversación con su historial de mensajes (detalle). */
export const assistantConversationDetailSchema = assistantConversationModelSchema.extend({
  messages: z.array(assistantMessageModelSchema),
});
export type AssistantConversationDetail = z.infer<typeof assistantConversationDetailSchema>;

/** POST /assistant/conversations */
export const createAssistantConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});
export type CreateAssistantConversationDto = z.infer<typeof createAssistantConversationSchema>;

/**
 * Tipos de entidad que el asistente sabe consumir como CONTEXTO de la vista
 * actual (asistente embebido, §3.4). El conjunto es FINITO y está acotado por los
 * inputs de las tools (no por las vistas): cada `kind` mapea a un parámetro que
 * alguna tool ya recibe (`assessmentId`, `classGroupId`, `itemId`, …). Agregar
 * una vista nueva NO amplía este enum — solo declara refs de estos `kind`.
 */
export const ASSISTANT_CONTEXT_KINDS = [
  'assessment',
  'classGroup',
  'grade',
  'subject',
  'instrument',
  'academicYear',
  'item',
  'student',
] as const;
export type AssistantContextKind = (typeof ASSISTANT_CONTEXT_KINDS)[number];
export const assistantContextKindSchema = z.enum(ASSISTANT_CONTEXT_KINDS);

/**
 * Referencia a una entidad que el usuario está viendo. PII opción B: solo el
 * `kind` + el `id` (UUID, pseudónimo opaco) viajan al LLM. El `label` es para el
 * chip en la UI (cliente) y NUNCA se envía al backend/LLM — el resolver
 * nombre→UUID ocurre en el cliente. Cubre tanto el selector `@` de alumno
 * (`kind: 'student'`) como el contexto auto-cargado de la página.
 */
export const assistantContextRefSchema = z.object({
  kind: assistantContextKindSchema,
  id: z.string().uuid(),
  /** Etiqueta legible para la UI (chip). No se transmite al backend/LLM. */
  label: z.string().max(200).optional(),
});
export type AssistantContextRef = z.infer<typeof assistantContextRefSchema>;

/** Contexto de la vista actual: lista de referencias tipadas (máx. 20). */
export const assistantPageContextSchema = z.array(assistantContextRefSchema).max(20);
export type AssistantPageContext = z.infer<typeof assistantPageContextSchema>;

/**
 * POST /assistant/conversations/:id/messages (respuesta vía stream SSE).
 *
 * `pageContext` son las entidades que el usuario está viendo (asistente embebido
 * + selector `@`, §3.4/§4.4): el cliente las declara por vista y el backend las
 * inyecta como DATOS delimitados en el turno (no como instrucciones), para que el
 * modelo pase esos UUIDs directo a las tools. PII opción B: solo `kind`+`id`
 * (UUID) llegan aquí; el NOMBRE nunca viaja al LLM. Se adjunta POR MENSAJE (el
 * usuario puede navegar mientras chatea → el contexto refleja "dónde está ahora").
 */
export const sendAssistantMessageSchema = z.object({
  content: z.string().min(1).max(4000),
  pageContext: assistantPageContextSchema.optional(),
});
export type SendAssistantMessageDto = z.infer<typeof sendAssistantMessageSchema>;

/** GET /assistant/conversations — query de paginación. */
export const assistantConversationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type AssistantConversationListQueryDto = z.infer<
  typeof assistantConversationListQuerySchema
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
