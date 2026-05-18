import {
  boolean,
  decimal,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import {
  gradingScaleTypeEnum,
  instrumentStatusEnum,
  instrumentTypeEnum,
  sectionTypeEnum,
} from './enums';
import { organizations } from './organizations';
import { grades, subjects } from './academic';
import { curricula } from './curriculum';
import { users } from './users';

export const gradingScales = pgTable('grading_scales', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id),
  name: text('name').notNull(),
  type: gradingScaleTypeEnum('type').notNull(),
  minGrade: decimal('min_grade', { precision: 5, scale: 2 }).default('1.00').notNull(),
  maxGrade: decimal('max_grade', { precision: 5, scale: 2 }).default('7.00').notNull(),
  passingGrade: decimal('passing_grade', { precision: 5, scale: 2 }).default('4.00').notNull(),
  passingThreshold: decimal('passing_threshold', { precision: 3, scale: 2 })
    .default('0.60')
    .notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const instruments = pgTable('instruments', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id),
  curriculumId: uuid('curriculum_id').references(() => curricula.id),
  name: text('name').notNull(),
  shortName: text('short_name'),
  type: instrumentTypeEnum('type').notNull(),
  subjectId: uuid('subject_id').references(() => subjects.id),
  gradeId: uuid('grade_id').references(() => grades.id),
  year: integer('year'),
  version: text('version'),
  isOfficial: boolean('is_official').default(false).notNull(),
  status: instrumentStatusEnum('status').default('draft').notNull(),
  gradingScaleId: uuid('grading_scale_id').references(() => gradingScales.id),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  createdById: uuid('created_by_id').references(() => users.id),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const instrumentSections = pgTable('instrument_sections', {
  id: uuid('id').defaultRandom().primaryKey(),
  instrumentId: uuid('instrument_id')
    .notNull()
    .references(() => instruments.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: sectionTypeEnum('type').notNull(),
  order: integer('order').default(0).notNull(),
  maxPoints: decimal('max_points', { precision: 7, scale: 2 }),
  timeLimitMin: integer('time_limit_min'),
  instructions: text('instructions'),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
});

export const instrumentsRelations = relations(instruments, ({ one, many }) => ({
  org: one(organizations, { fields: [instruments.orgId], references: [organizations.id] }),
  curriculum: one(curricula, {
    fields: [instruments.curriculumId],
    references: [curricula.id],
  }),
  subject: one(subjects, { fields: [instruments.subjectId], references: [subjects.id] }),
  grade: one(grades, { fields: [instruments.gradeId], references: [grades.id] }),
  gradingScale: one(gradingScales, {
    fields: [instruments.gradingScaleId],
    references: [gradingScales.id],
  }),
  sections: many(instrumentSections),
}));

export const instrumentSectionsRelations = relations(instrumentSections, ({ one }) => ({
  instrument: one(instruments, {
    fields: [instrumentSections.instrumentId],
    references: [instruments.id],
  }),
}));

export type GradingScale = typeof gradingScales.$inferSelect;
export type NewGradingScale = typeof gradingScales.$inferInsert;
export type Instrument = typeof instruments.$inferSelect;
export type NewInstrument = typeof instruments.$inferInsert;
export type InstrumentSection = typeof instrumentSections.$inferSelect;
export type NewInstrumentSection = typeof instrumentSections.$inferInsert;
