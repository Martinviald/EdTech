import { boolean, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Participación de una org en benchmarking (F2 S0 — H19.24). Una fila por org.
 * Guarda SOLO lo que no se deriva: opt-out del pool global anónimo + consentimiento.
 * La red/sostenedor NO se almacena aquí — se deriva de organizations.parent_id.
 * RLS por org_id (ver packages/db/sql/rls-policies.sql).
 */
export const orgBenchmarkSettings = pgTable(
  'org_benchmark_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    optOutGlobalPool: boolean('opt_out_global_pool').notNull().default(false),
    consentGrantedAt: timestamp('consent_granted_at'),
    consentGrantedById: uuid('consent_granted_by_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.orgId)],
);

export const orgBenchmarkSettingsRelations = relations(orgBenchmarkSettings, ({ one }) => ({
  org: one(organizations, {
    fields: [orgBenchmarkSettings.orgId],
    references: [organizations.id],
  }),
}));

export type OrgBenchmarkSettings = typeof orgBenchmarkSettings.$inferSelect;
export type NewOrgBenchmarkSettings = typeof orgBenchmarkSettings.$inferInsert;
