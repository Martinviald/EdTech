import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Auditoría de accesos al servidor MCP analítico. Una fila por invocación de tool
 * (canal externo Claude/ChatGPT o asistente in-app). Trazabilidad de qué dato salió
 * hacia el LLM (compliance Ley 19.628). RLS por `org_id`. No guarda los argumentos
 * crudos: solo su hash, para no persistir posibles datos sensibles de la consulta.
 */
export const mcpAccessLogs = pgTable(
  'mcp_access_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id),
    tool: text('tool').notNull(),
    argsHash: text('args_hash'),
    channel: text('channel').notNull(),
    ok: boolean('ok').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('mcp_access_logs_org_idx').on(table.orgId, table.createdAt)],
);

export const mcpAccessLogsRelations = relations(mcpAccessLogs, ({ one }) => ({
  org: one(organizations, {
    fields: [mcpAccessLogs.orgId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [mcpAccessLogs.userId],
    references: [users.id],
  }),
}));

export type McpAccessLog = typeof mcpAccessLogs.$inferSelect;
export type NewMcpAccessLog = typeof mcpAccessLogs.$inferInsert;
