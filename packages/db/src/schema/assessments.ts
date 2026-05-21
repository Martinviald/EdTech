import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import {
  assessmentModeEnum,
  assessmentStatusEnum,
  importJobStatusEnum,
  importJobTypeEnum,
} from './enums';
import { organizations } from './organizations';
import { classGroups } from './academic';
import { instruments } from './instruments';
import { users } from './users';

export const assessments = pgTable('assessments', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  instrumentId: uuid('instrument_id')
    .notNull()
    .references(() => instruments.id),
  name: text('name'),
  administeredById: uuid('administered_by_id').references(() => users.id),
  mode: assessmentModeEnum('mode').default('paper').notNull(),
  status: assessmentStatusEnum('status').default('scheduled').notNull(),
  scheduledFor: timestamp('scheduled_for'),
  administeredAt: timestamp('administered_at'),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const assessmentCourseAssignments = pgTable(
  'assessment_course_assignments',
  {
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    classGroupId: uuid('class_group_id')
      .notNull()
      .references(() => classGroups.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.assessmentId, table.classGroupId] })],
);

export const assessmentForms = pgTable('assessment_forms', {
  id: uuid('id').defaultRandom().primaryKey(),
  assessmentId: uuid('assessment_id')
    .notNull()
    .references(() => assessments.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  itemOrder: uuid('item_order').array(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const importJobs = pgTable('import_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id').references(() => assessments.id),
  type: importJobTypeEnum('type').notNull(),
  status: importJobStatusEnum('status').default('pending').notNull(),
  fileUrl: text('file_url').notNull(),
  mappingConfig: jsonb('mapping_config').$type<Record<string, unknown>>().default({}),
  result: jsonb('result').$type<{
    rowsProcessed?: number;
    errors?: number;
    warnings?: number;
  }>(),
  errorLog: jsonb('error_log').$type<Array<{ row: number; message: string }>>(),
  createdById: uuid('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

export const assessmentsRelations = relations(assessments, ({ one, many }) => ({
  org: one(organizations, { fields: [assessments.orgId], references: [organizations.id] }),
  instrument: one(instruments, {
    fields: [assessments.instrumentId],
    references: [instruments.id],
  }),
  administeredBy: one(users, {
    fields: [assessments.administeredById],
    references: [users.id],
  }),
  courseAssignments: many(assessmentCourseAssignments),
  forms: many(assessmentForms),
}));

export const assessmentCourseAssignmentsRelations = relations(
  assessmentCourseAssignments,
  ({ one }) => ({
    assessment: one(assessments, {
      fields: [assessmentCourseAssignments.assessmentId],
      references: [assessments.id],
    }),
    classGroup: one(classGroups, {
      fields: [assessmentCourseAssignments.classGroupId],
      references: [classGroups.id],
    }),
  }),
);

export const assessmentFormsRelations = relations(assessmentForms, ({ one }) => ({
  assessment: one(assessments, {
    fields: [assessmentForms.assessmentId],
    references: [assessments.id],
  }),
}));

export type Assessment = typeof assessments.$inferSelect;
export type NewAssessment = typeof assessments.$inferInsert;
export type AssessmentForm = typeof assessmentForms.$inferSelect;
export type NewAssessmentForm = typeof assessmentForms.$inferInsert;
export type ImportJob = typeof importJobs.$inferSelect;
export type NewImportJob = typeof importJobs.$inferInsert;
