import { boolean, date, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { orgTypeEnum } from './enums';

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: orgTypeEnum('type').notNull(),
  parentId: uuid('parent_id'),
  name: text('name').notNull(),
  rbd: text('rbd'),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  parent: one(organizations, {
    fields: [organizations.parentId],
    references: [organizations.id],
    relationName: 'org_parent',
  }),
  children: many(organizations, { relationName: 'org_parent' }),
  academicYears: many(academicYears),
}));

export const academicYears = pgTable('academic_years', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  startDate: date('start_date'),
  endDate: date('end_date'),
  isCurrent: boolean('is_current').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const academicYearsRelations = relations(academicYears, ({ one }) => ({
  org: one(organizations, {
    fields: [academicYears.orgId],
    references: [organizations.id],
  }),
}));

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type AcademicYear = typeof academicYears.$inferSelect;
export type NewAcademicYear = typeof academicYears.$inferInsert;
