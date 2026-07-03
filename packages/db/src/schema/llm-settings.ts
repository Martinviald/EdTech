import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import type { LlmFeature, LlmProviderId } from '@soe/types';
import { organizations } from './organizations';

/**
 * Configuración de modelo de IA por funcionalidad (`LlmFeature`).
 *
 * `org_id = NULL` ⇒ configuración GLOBAL de plataforma (vale para todas las orgs).
 * Filas con `org_id` ⇒ override per-org (futuro). Patrón idéntico a
 * `performance_bands` (catálogo global con `org_id` nullable + RLS que admite NULL,
 * ver `packages/db/sql/rls-policies.sql`). `LlmConfigService.resolve` consulta esta
 * tabla en runtime; el panel /configuracion/modelos-ia la escribe.
 */
export const llmSettings = pgTable(
  'llm_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** null = config global; uuid = override per-org (futuro). */
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    feature: text('feature').$type<LlmFeature>().notNull(),
    provider: text('provider').$type<LlmProviderId>().notNull(),
    model: text('model').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // Una sola fila GLOBAL por funcionalidad (índice parcial: Postgres trata los
    // NULL como distintos en un unique normal, por eso se restringe a org_id IS NULL).
    uniqueIndex('llm_settings_global_feature_uniq')
      .on(table.feature)
      .where(sql`${table.orgId} IS NULL`),
    // Una sola fila por (org, funcionalidad) para overrides per-org (futuro).
    uniqueIndex('llm_settings_org_feature_uniq')
      .on(table.orgId, table.feature)
      .where(sql`${table.orgId} IS NOT NULL`),
  ],
);

export const llmSettingsRelations = relations(llmSettings, ({ one }) => ({
  org: one(organizations, {
    fields: [llmSettings.orgId],
    references: [organizations.id],
  }),
}));

export type LlmSetting = typeof llmSettings.$inferSelect;
export type NewLlmSetting = typeof llmSettings.$inferInsert;
