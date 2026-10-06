import {
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import type {
  DecisionAnswerRecord,
  DecisionEngineId,
  DecisionFeature,
  DecisionThresholds,
} from '@soe/types';
import { decisionCallStatusEnum, decisionModeEnum } from './enums';
import { organizations } from './organizations';

/**
 * Configuración del motor de decisiones por funcionalidad (`DecisionFeature`).
 *
 * Patrón idéntico a `llm_settings`: `org_id = NULL` ⇒ configuración GLOBAL de
 * plataforma; filas con `org_id` ⇒ override per-org. Sin fila, rigen los
 * `DECISION_FEATURE_DEFAULTS` de `@soe/types` (modo `off`). RLS admite las filas
 * globales (ver `packages/db/sql/rls-policies.sql`).
 */
export const decisionSettings = pgTable(
  'decision_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** null = config global; uuid = override per-org. */
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    feature: text('feature').$type<DecisionFeature>().notNull(),
    engine: text('engine').$type<DecisionEngineId>().notNull().default('jev'),
    /** Versión fijada del modelo (p. ej. `jev-1.13.0`): los umbrales se calibran contra ella. */
    model: text('model').notNull(),
    mode: decisionModeEnum('mode').notNull().default('off'),
    /** Umbrales de enrutamiento por id de pregunta (validados con `decisionThresholdsSchema`). */
    thresholds: jsonb('thresholds').$type<DecisionThresholds>().notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // Una sola fila GLOBAL por funcionalidad (índice parcial: Postgres trata los
    // NULL como distintos en un unique normal).
    uniqueIndex('decision_settings_global_feature_uniq')
      .on(table.feature)
      .where(sql`${table.orgId} IS NULL`),
    // Una sola fila por (org, funcionalidad) para overrides per-org.
    uniqueIndex('decision_settings_org_feature_uniq')
      .on(table.orgId, table.feature)
      .where(sql`${table.orgId} IS NOT NULL`),
  ],
);

export const decisionSettingsRelations = relations(decisionSettings, ({ one }) => ({
  org: one(organizations, {
    fields: [decisionSettings.orgId],
    references: [organizations.id],
  }),
}));

export type DecisionSetting = typeof decisionSettings.$inferSelect;
export type NewDecisionSetting = typeof decisionSettings.$inferInsert;

/**
 * Registro inmutable de cada llamada al motor de decisiones (modos `shadow` y `live`).
 *
 * Nunca guarda el estado en claro: solo `state_hash` (sha256 hex del JSON del
 * estado). En sombra, `baseline` guarda lo que decidió el sistema actual para
 * compararlo después con `answers`. Sin `updated_at` ni `deleted_at`: es un log.
 * Bajo RLS por `org_id` (se escribe dentro de `withOrgContext`).
 */
export const decisionCalls = pgTable(
  'decision_calls',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    feature: text('feature').$type<DecisionFeature>().notNull(),
    engine: text('engine').$type<DecisionEngineId>().notNull(),
    /** Versión que respondió; null si la llamada falló antes de responder. */
    model: text('model'),
    mode: decisionModeEnum('mode').notNull(),
    status: decisionCallStatusEnum('status').notNull(),
    errorCode: text('error_code'),
    /** Respuestas por id de pregunta. */
    answers: jsonb('answers').$type<Record<string, DecisionAnswerRecord>>(),
    /** Lo que decidió el sistema actual (modo sombra), para medir acuerdo. */
    baseline: jsonb('baseline').$type<Record<string, unknown>>(),
    stateHash: text('state_hash').notNull(),
    /** Id del objeto evaluado (p. ej. el material remedial). */
    correlationId: text('correlation_id'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    latencyMs: integer('latency_ms'),
    costUsd: decimal('cost_usd', { precision: 14, scale: 9 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('decision_calls_org_feature_created_idx').on(table.orgId, table.feature, table.createdAt),
  ],
);

export const decisionCallsRelations = relations(decisionCalls, ({ one }) => ({
  org: one(organizations, {
    fields: [decisionCalls.orgId],
    references: [organizations.id],
  }),
}));

export type DecisionCall = typeof decisionCalls.$inferSelect;
export type NewDecisionCall = typeof decisionCalls.$inferInsert;
