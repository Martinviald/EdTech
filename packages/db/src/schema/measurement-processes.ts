import { date, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type { ExpectedScope } from '@soe/types';
import { instrumentApplicationPeriodEnum, processKindEnum, processStatusEnum } from './enums';
import { academicYears, organizations } from './organizations';
import { taxonomies } from './taxonomy';
import { users } from './users';

export const measurementProcesses = pgTable(
  'measurement_processes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    kind: processKindEnum('kind').notNull(),
    period: instrumentApplicationPeriodEnum('period'),
    taxonomyId: uuid('taxonomy_id').references(() => taxonomies.id),
    status: processStatusEnum('status').default('planned').notNull(),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    expectedScope: jsonb('expected_scope').$type<ExpectedScope>().default({}).notNull(),
    ownerId: uuid('owner_id').references(() => users.id),
    notes: text('notes'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('measurement_processes_org_slug_unique').on(table.orgId, table.slug),
    index('idx_measurement_processes_org_year').on(table.orgId, table.academicYearId),
  ],
);

export const measurementProcessesRelations = relations(measurementProcesses, ({ one }) => ({
  org: one(organizations, {
    fields: [measurementProcesses.orgId],
    references: [organizations.id],
  }),
  academicYear: one(academicYears, {
    fields: [measurementProcesses.academicYearId],
    references: [academicYears.id],
  }),
  taxonomy: one(taxonomies, {
    fields: [measurementProcesses.taxonomyId],
    references: [taxonomies.id],
  }),
  owner: one(users, {
    fields: [measurementProcesses.ownerId],
    references: [users.id],
  }),
}));

export type MeasurementProcess = typeof measurementProcesses.$inferSelect;
export type NewMeasurementProcess = typeof measurementProcesses.$inferInsert;
