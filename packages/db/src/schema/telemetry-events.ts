import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type { TelemetryContext, TelemetrySource, UserRole } from '@soe/types';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Telemetría de uso de la plataforma (analítica de producto). Tabla polimórfica:
 * `eventName` es la clave del REGISTRO tipado de eventos (packages/types
 * telemetry.schema.ts), no un enum en la DB — así una feature nueva se instrumenta
 * sin migración (Open/Closed, igual que ai_analyses.analysisType). `properties`
 * varía por evento y se valida en la capa de aplicación con Zod.
 *
 * NO confundir con `audit_logs` (auditoría de cumplimiento Ley 19.628, PII).
 * Acá NO va PII: sólo qué se usó, quién (por org/rol) y cuándo, para saber qué
 * aporta valor. RLS por org_id (ver packages/db/sql/rls-policies.sql).
 *
 * `role` denormaliza el rol activo del actor al momento del evento para segmentar
 * por rol sin join contra memberships (que además cambian en el tiempo).
 */
export const telemetryEvents = pgTable(
  'telemetry_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    eventName: text('event_name').notNull(),
    eventCategory: text('event_category').notNull(),
    source: text('source').$type<TelemetrySource>().notNull().default('web'),
    role: text('role').$type<UserRole>(),
    properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default({}),
    context: jsonb('context').$type<TelemetryContext>().notNull().default({}),
    occurredAt: timestamp('occurred_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('telemetry_events_org_created_idx').on(table.orgId, table.createdAt),
    index('telemetry_events_org_name_idx').on(table.orgId, table.eventName),
    index('telemetry_events_org_category_idx').on(table.orgId, table.eventCategory),
    index('telemetry_events_org_user_idx').on(table.orgId, table.userId),
  ],
);

export const telemetryEventsRelations = relations(telemetryEvents, ({ one }) => ({
  org: one(organizations, {
    fields: [telemetryEvents.orgId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [telemetryEvents.userId],
    references: [users.id],
  }),
}));

export type TelemetryEventRow = typeof telemetryEvents.$inferSelect;
export type NewTelemetryEventRow = typeof telemetryEvents.$inferInsert;
