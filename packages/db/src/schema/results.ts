import { boolean, decimal, integer, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { performanceLevelEnum } from './enums';
import { assessments } from './assessments';
import { students } from './students';
import { taxonomyNodes } from './curriculum';

export const assessmentResults = pgTable(
  'assessment_results',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    totalScore: decimal('total_score', { precision: 7, scale: 2 }),
    maxScore: decimal('max_score', { precision: 7, scale: 2 }),
    percentage: decimal('percentage', { precision: 5, scale: 2 }),
    grade: decimal('grade', { precision: 5, scale: 2 }),
    performanceLevel: performanceLevelEnum('performance_level'),
    isComplete: boolean('is_complete').default(false).notNull(),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.assessmentId, table.studentId)],
);

export const skillResults = pgTable(
  'skill_results',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => taxonomyNodes.id, { onDelete: 'cascade' }),
    correctCount: integer('correct_count').default(0).notNull(),
    totalCount: integer('total_count').default(0).notNull(),
    percentage: decimal('percentage', { precision: 5, scale: 2 }),
    performanceLevel: performanceLevelEnum('performance_level'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.assessmentId, table.studentId, table.nodeId)],
);

export const assessmentResultsRelations = relations(assessmentResults, ({ one }) => ({
  assessment: one(assessments, {
    fields: [assessmentResults.assessmentId],
    references: [assessments.id],
  }),
  student: one(students, { fields: [assessmentResults.studentId], references: [students.id] }),
}));

export const skillResultsRelations = relations(skillResults, ({ one }) => ({
  assessment: one(assessments, {
    fields: [skillResults.assessmentId],
    references: [assessments.id],
  }),
  student: one(students, { fields: [skillResults.studentId], references: [students.id] }),
  node: one(taxonomyNodes, {
    fields: [skillResults.nodeId],
    references: [taxonomyNodes.id],
  }),
}));

export type AssessmentResult = typeof assessmentResults.$inferSelect;
export type NewAssessmentResult = typeof assessmentResults.$inferInsert;
export type SkillResult = typeof skillResults.$inferSelect;
export type NewSkillResult = typeof skillResults.$inferInsert;
