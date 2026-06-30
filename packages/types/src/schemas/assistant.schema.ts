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

// ── Contexto del asistente (refs tipadas) ────────────────────────────────────
// Se define ANTES del modelo de conversación porque tanto el contexto de la vista
// (auto) como la bandeja fijada por el usuario (E21 Ola 5) lo usan.

/**
 * Tipos de entidad que el asistente sabe consumir como CONTEXTO (asistente
 * embebido, §3.4). El conjunto es FINITO y está acotado por los inputs de las
 * tools (no por las vistas): cada `kind` mapea a un parámetro que alguna tool ya
 * recibe (`assessmentId`, `classGroupId`, `itemId`, …). Agregar una vista nueva
 * NO amplía este enum — solo declara refs de estos `kind`.
 *
 * ⚠️ Matriz kind→tool (Ola 5): cada `kind` que el usuario pueda FIJAR debe tener
 * una tool que lo resuelva. `instrument` → `get_instrument` (nueva en Ola 5);
 * `assessment` → `get_assessment_report`/`list_assessments`; `item` →
 * `get_item_content`; `student` → `get_student_detail`; `classGroup`/`grade`/
 * `subject`/`academicYear` → `list_filter_options` + filtros de dashboard.
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
 * Referencia a una entidad de contexto. PII opción B: solo el `kind` + el `id`
 * (UUID, pseudónimo opaco) viajan al LLM. El `label` es para el chip en la UI y
 * NUNCA se envía al LLM (el resolver nombre→UUID ocurre en el cliente). Cubre
 * tanto el selector `@` de alumno (`kind: 'student'`), el contexto auto-cargado de
 * la página, como la bandeja fijada por el usuario (Ola 5).
 *
 * El `label` SÍ puede persistirse en `pinned_context` (display interno org-scoped,
 * RLS) para rehidratar el chip al recargar — el guardrail PII se mantiene porque
 * `buildUserTurnText` serializa solo `kind+id` hacia el modelo.
 */
export const assistantContextRefSchema = z.object({
  kind: assistantContextKindSchema,
  id: z.string().uuid(),
  /** Etiqueta legible para la UI (chip). No se transmite al LLM. */
  label: z.string().max(200).optional(),
});
export type AssistantContextRef = z.infer<typeof assistantContextRefSchema>;

/** Lista de referencias tipadas de contexto (máx. 20). */
export const assistantPageContextSchema = z.array(assistantContextRefSchema).max(20);
export type AssistantPageContext = z.infer<typeof assistantPageContextSchema>;

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

/**
 * Conversación con su historial de mensajes (detalle). Incluye `pinnedContext`
 * (Ola 5): la bandeja de referencias fijadas por el usuario, para rehidratar los
 * chips al reabrir el hilo. Listados NO lo traen (payload liviano).
 */
export const assistantConversationDetailSchema = assistantConversationModelSchema.extend({
  messages: z.array(assistantMessageModelSchema),
  pinnedContext: assistantPageContextSchema.default([]),
});
export type AssistantConversationDetail = z.infer<typeof assistantConversationDetailSchema>;

/** POST /assistant/conversations */
export const createAssistantConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});
export type CreateAssistantConversationDto = z.infer<typeof createAssistantConversationSchema>;

/**
 * PUT /assistant/conversations/:id/context (E21 Ola 5).
 *
 * Reemplaza la bandeja de contexto fijada del hilo. El cliente envía el set
 * completo de refs (no un delta). El `label` viaja para persistirlo como display
 * del chip; NUNCA llega al LLM (lo filtra `buildUserTurnText`).
 */
export const updateAssistantContextSchema = z.object({
  pinnedContext: assistantPageContextSchema,
});
export type UpdateAssistantContextDto = z.infer<typeof updateAssistantContextSchema>;

/** Respuesta de PUT …/context: eco de la bandeja persistida (slim). */
export const assistantContextUpdateResponseSchema = z.object({
  pinnedContext: assistantPageContextSchema,
});
export type AssistantContextUpdateResponse = z.infer<typeof assistantContextUpdateResponseSchema>;

/**
 * POST /assistant/conversations/:id/messages (respuesta vía stream SSE).
 *
 * `pageContext` son las entidades que el usuario está viendo (asistente embebido
 * + selector `@`, §3.4/§4.4): el cliente las declara por vista y el backend las
 * inyecta como DATOS delimitados en el turno (no como instrucciones), para que el
 * modelo pase esos UUIDs directo a las tools. PII opción B: solo `kind`+`id`
 * (UUID) llegan aquí; el NOMBRE nunca viaja al LLM. Se adjunta POR MENSAJE (el
 * usuario puede navegar mientras chatea → el contexto refleja "dónde está ahora").
 *
 * Ola 5: la bandeja FIJADA por el usuario (`pinned_context`) se persiste en la
 * conversación y el backend la fusiona con este `pageContext` (auto) en cada turno
 * — el cliente NO necesita reenviarla aquí.
 */
export const sendAssistantMessageSchema = z.object({
  content: z.string().min(1).max(4000),
  pageContext: assistantPageContextSchema.optional(),
});
export type SendAssistantMessageDto = z.infer<typeof sendAssistantMessageSchema>;

// ── Búsqueda unificada de contexto (E21 Ola 5) ───────────────────────────────
// Generaliza el selector `@` de alumno (H21.11b) a cualquier `kind` fijable. El
// cliente busca por nombre (autocompletado) y al elegir inserta `{kind, id, label}`
// en la bandeja. El `label` (nombre) solo viaja hacia el navegador del directivo;
// NUNCA hacia el LLM. Todo scoped por `org_id` del JWT dentro de `withOrgContext`.

/** GET /assistant/context-search — busca entidades del scope por `kind` + nombre. */
export const assistantContextSearchQuerySchema = z.object({
  kind: assistantContextKindSchema,
  q: z.string().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});
export type AssistantContextSearchQueryDto = z.infer<typeof assistantContextSearchQuerySchema>;

/** Resultado de búsqueda: `{kind, id}` (lo que va a la bandeja) + `label` (UI). */
export const assistantContextSearchResultSchema = z.object({
  kind: assistantContextKindSchema,
  id: z.string().uuid(),
  label: z.string(),
});
export type AssistantContextSearchResult = z.infer<typeof assistantContextSearchResultSchema>;

export const assistantContextSearchResponseSchema = z.object({
  data: z.array(assistantContextSearchResultSchema),
});
export type AssistantContextSearchResponse = z.infer<typeof assistantContextSearchResponseSchema>;

// ── Selector `@` de alumno (H21.11b, PII opción B) ───────────────────────────
// Compat: el endpoint dedicado de alumnos se mantiene. El selector `@` y la
// búsqueda unificada (kind='student') comparten el mismo resolver en el service.

/** GET /assistant/students — query de búsqueda de alumnos del scope. */
export const assistantStudentSearchQuerySchema = z.object({
  q: z.string().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});
export type AssistantStudentSearchQueryDto = z.infer<typeof assistantStudentSearchQuerySchema>;

/** Alumno encontrado: `id` (UUID, el que va al contexto) + nombre (solo UI). */
export const assistantStudentResultSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
});
export type AssistantStudentResult = z.infer<typeof assistantStudentResultSchema>;

export const assistantStudentSearchResponseSchema = z.object({
  data: z.array(assistantStudentResultSchema),
});
export type AssistantStudentSearchResponse = z.infer<typeof assistantStudentSearchResponseSchema>;

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
