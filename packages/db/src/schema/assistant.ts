import { decimal, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { assistantMessageRoleEnum } from './enums';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Conversación del asistente IA (E21). Un hilo de chat por usuario. RLS por
 * org_id (ver packages/db/sql/rls-policies.sql). Soft delete vía deleted_at.
 */
export const assistantConversations = pgTable(
  'assistant_conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Título autogenerado del primer mensaje; null hasta fijarse. */
    title: text('title'),
    /**
     * Bandeja de contexto FIJADA por el usuario (E21 Ola 5): refs `{kind, id,
     * label?}` que el usuario adjunta al hilo y persisten entre turnos. El backend
     * las fusiona con el `pageContext` (auto) en cada turno; al LLM solo viajan
     * `kind+id`. El `label` se guarda para rehidratar el chip (display org-scoped).
     */
    pinnedContext: jsonb('pinned_context')
      .$type<Array<{ kind: string; id: string; label?: string }>>()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('assistant_conversations_owner_idx').on(table.orgId, table.userId),
  ],
);

/**
 * Mensaje de una conversación. Cada fila es un turno (`user`/`assistant`). Las
 * tools ejecutadas en el turno del asistente quedan como traza en `toolCalls`
 * (auditoría de qué datos vio el modelo + UI). Costo/tokens por turno alimentan
 * AiObservabilityService (mismo patrón que ai_analyses). RLS por org_id.
 */
export const assistantMessages = pgTable(
  'assistant_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => assistantConversations.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: assistantMessageRoleEnum('role').notNull(),
    content: text('content').notNull().default(''),
    /** Trazas de tools del turno: [{ name, input, isError }]. */
    toolCalls: jsonb('tool_calls').$type<
      Array<{ name: string; input: Record<string, unknown>; isError: boolean }>
    >(),
    model: text('model'),
    promptVersion: text('prompt_version'),
    tokens: jsonb('tokens').$type<{ input: number; output: number }>(),
    costUsd: decimal('cost_usd', { precision: 10, scale: 6 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('assistant_messages_conversation_idx').on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

export const assistantConversationsRelations = relations(
  assistantConversations,
  ({ one, many }) => ({
    org: one(organizations, {
      fields: [assistantConversations.orgId],
      references: [organizations.id],
    }),
    user: one(users, {
      fields: [assistantConversations.userId],
      references: [users.id],
    }),
    messages: many(assistantMessages),
  }),
);

export const assistantMessagesRelations = relations(
  assistantMessages,
  ({ one }) => ({
    conversation: one(assistantConversations, {
      fields: [assistantMessages.conversationId],
      references: [assistantConversations.id],
    }),
  }),
);

export type AssistantConversation = typeof assistantConversations.$inferSelect;
export type NewAssistantConversation =
  typeof assistantConversations.$inferInsert;
export type AssistantMessage = typeof assistantMessages.$inferSelect;
export type NewAssistantMessage = typeof assistantMessages.$inferInsert;
