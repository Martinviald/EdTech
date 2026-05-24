import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { organizations } from './organizations';

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  orgId: uuid('org_id').references(() => organizations.id),
  action: text('action').notNull(), // 'export_students' | 'export_results' | 'anonymize_student'
  resourceType: text('resource_type').notNull(), // 'students' | 'assessment_results' | 'skill_results'
  resourceFilter: jsonb('resource_filter').$type<Record<string, unknown>>(), // filtros aplicados en la exportación
  recordCount: integer('record_count'), // cuántos registros fueron exportados/afectados
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
  org: one(organizations, { fields: [auditLogs.orgId], references: [organizations.id] }),
}));

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
