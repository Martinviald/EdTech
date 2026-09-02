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

/**
 * Organización activa del canal MCP, por usuario. Un usuario multi-org elige
 * sobre qué colegio operan las tools; se persiste aquí (patrón espejo del
 * switch-org de la app web). Una sola org activa por usuario (PK en `user_id`),
 * compartida entre todos sus clientes MCP.
 *
 * NO lleva RLS: es preferencia del propio usuario, no dato de tenant. Se
 * lee/escribe SIEMPRE filtrando por el `user_id` autenticado (sale del token
 * validado, nunca del input), así que no hay riesgo de leak cross-tenant. La
 * membresía en la org se RE-VALIDA en cada request contra `org_memberships`.
 */
export const mcpUserActiveOrg = pgTable('mcp_user_active_org', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const mcpUserActiveOrgRelations = relations(mcpUserActiveOrg, ({ one }) => ({
  user: one(users, {
    fields: [mcpUserActiveOrg.userId],
    references: [users.id],
  }),
  org: one(organizations, {
    fields: [mcpUserActiveOrg.orgId],
    references: [organizations.id],
  }),
}));

export type McpUserActiveOrg = typeof mcpUserActiveOrg.$inferSelect;
export type NewMcpUserActiveOrg = typeof mcpUserActiveOrg.$inferInsert;
