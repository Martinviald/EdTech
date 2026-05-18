import {
  boolean,
  decimal,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { scoredByEnum } from './enums';
import { assessments, assessmentForms } from './assessments';
import { students } from './students';
import { items } from './items';

export const responses = pgTable(
  'responses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    formId: uuid('form_id').references(() => assessmentForms.id),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    value: jsonb('value').$type<Record<string, unknown>>().notNull().default({}),
    isCorrect: boolean('is_correct'),
    rawScore: decimal('raw_score', { precision: 7, scale: 2 }),
    maxScore: decimal('max_score', { precision: 7, scale: 2 }).notNull(),
    aiScore: jsonb('ai_score').$type<{
      score?: number;
      confidence?: number;
      justification?: string;
      model?: string;
      promptVersion?: string;
    }>(),
    humanScore: jsonb('human_score').$type<{
      score?: number;
      overrideReason?: string;
      scoredById?: string;
    }>(),
    finalScore: decimal('final_score', { precision: 7, scale: 2 }),
    scoredBy: scoredByEnum('scored_by'),
    scoredAt: timestamp('scored_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.assessmentId, table.studentId, table.itemId)],
);

export const aiGradingJobs = pgTable('ai_grading_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  responseId: uuid('response_id')
    .notNull()
    .references(() => responses.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  status: text('status').default('pending').notNull(),
  model: text('model'),
  promptVersion: text('prompt_version'),
  input: jsonb('input').$type<Record<string, unknown>>(),
  output: jsonb('output').$type<Record<string, unknown>>(),
  score: decimal('score', { precision: 7, scale: 2 }),
  confidence: decimal('confidence', { precision: 3, scale: 2 }),
  justification: text('justification'),
  costUsd: decimal('cost_usd', { precision: 10, scale: 6 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

export const responsesRelations = relations(responses, ({ one }) => ({
  assessment: one(assessments, {
    fields: [responses.assessmentId],
    references: [assessments.id],
  }),
  student: one(students, { fields: [responses.studentId], references: [students.id] }),
  item: one(items, { fields: [responses.itemId], references: [items.id] }),
}));

export type Response = typeof responses.$inferSelect;
export type NewResponse = typeof responses.$inferInsert;
export type AiGradingJob = typeof aiGradingJobs.$inferSelect;
