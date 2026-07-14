import {
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type { ItemContent } from '@soe/types';
import { itemEditProposalStatusEnum, itemTypeEnum, taggedByEnum } from './enums';
import { organizations } from './organizations';
import { items } from './items';
import { users } from './users';

/**
 * Propuestas de edición del contenido de un ítem (TKT-19 — escritura asistida por
 * IA). Materializa el principio §8.3 del proyecto: **la IA propone, el humano
 * aprueba**. El asistente (o un editor) genera una PROPUESTA de nuevo `content`
 * del ítem, que NO toca el ítem real: queda en `pending` hasta que un rol de
 * edición de ítems la aprueba (recién ahí se aplica al `items.content`, versionado)
 * o la rechaza.
 *
 * - RLS por `org_id` (ver packages/db/sql/rls-policies.sql) — per-tenant. El
 *   `org_id` proviene SIEMPRE del token, nunca del body. Toda query corre dentro
 *   de `withOrgContext`.
 * - §8.3 (evidencia inmutable): `proposedContent` (lo que generó la IA) y
 *   `currentContent` (snapshot del ítem al momento de proponer, para el diff)
 *   NUNCA se sobrescriben. Aprobar aplica `proposedContent` al ítem vía el
 *   ItemsService (que versiona el cambio); rechazar solo marca `rejected`.
 * - Polimorfismo: `itemType` guarda el tipo del ítem al proponer y `proposedContent`
 *   se valida contra el schema Zod de ese tipo (`validateItemContent`). Cero tablas
 *   nuevas por tipo de ítem.
 * - Trazabilidad IA: `author`, `model`, `promptVersion`, `tokens`, `costUsd`.
 */
export const itemEditProposals = pgTable(
  'item_edit_proposals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    status: itemEditProposalStatusEnum('status').notNull().default('pending'),
    // Quién ORIGINÓ la propuesta: 'ai' (asistente) o 'human' (edición manual con
    // el mismo flujo de aprobación). Por defecto 'ai' — es su caso de uso.
    author: taggedByEnum('author').notNull().default('ai'),
    // Tipo del ítem al momento de proponer — `proposedContent` se valida contra él.
    itemType: itemTypeEnum('item_type').notNull(),
    // Instrucción del humano que gatilló la propuesta ("mejora la redacción del
    // enunciado", "la clave correcta debería ser B", …). Auditoría, no PII.
    instruction: text('instruction'),
    // Explicación/razonamiento de la IA sobre el cambio propuesto (para el diff).
    reasoning: text('reasoning'),
    // Snapshot del `content` del ítem al momento de proponer (para el diff en la UI
    // sin depender de una lectura posterior que podría haber cambiado). Evidencia.
    currentContent: jsonb('current_content').$type<ItemContent>(),
    // Contenido PROPUESTO por la IA (validado contra `itemType`). Evidencia IA —
    // inmutable tras crear la propuesta (§8.3).
    proposedContent: jsonb('proposed_content').$type<ItemContent>().notNull(),
    // Versión del ítem resultante tras aplicar la propuesta aprobada (auditoría).
    appliedVersion: integer('applied_version'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    tokens: jsonb('tokens').$type<{ input: number; output: number }>(),
    costUsd: decimal('cost_usd', { precision: 10, scale: 6 }),
    createdById: uuid('created_by_id').references(() => users.id),
    reviewedById: uuid('reviewed_by_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    reviewedAt: timestamp('reviewed_at'),
  },
  (table) => [index('item_edit_proposals_lookup_idx').on(table.orgId, table.itemId, table.status)],
);

export const itemEditProposalsRelations = relations(itemEditProposals, ({ one }) => ({
  org: one(organizations, {
    fields: [itemEditProposals.orgId],
    references: [organizations.id],
  }),
  item: one(items, { fields: [itemEditProposals.itemId], references: [items.id] }),
  createdBy: one(users, {
    fields: [itemEditProposals.createdById],
    references: [users.id],
  }),
  reviewedBy: one(users, {
    fields: [itemEditProposals.reviewedById],
    references: [users.id],
  }),
}));

export type ItemEditProposal = typeof itemEditProposals.$inferSelect;
export type NewItemEditProposal = typeof itemEditProposals.$inferInsert;
