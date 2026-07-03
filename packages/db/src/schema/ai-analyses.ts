import { decimal, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { aiAnalysisStatusEnum } from './enums';
import { organizations } from './organizations';
import { assessments } from './assessments';

/**
 * Registro de análisis IA (F2 S0 — H19.23). Sirve a la vez de job async (status)
 * y de caché (inputHash). `analysisType`/`audience` quedan como text (Open/Closed:
 * nuevos tipos sin migración). RLS por org_id (ver packages/db/sql/rls-policies.sql).
 */
export const aiAnalyses = pgTable(
  'ai_analyses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id').references(() => assessments.id, { onDelete: 'cascade' }),
    classGroupId: uuid('class_group_id'),
    analysisType: text('analysis_type').notNull(),
    audience: text('audience').notNull().default('general'),
    status: aiAnalysisStatusEnum('status').notNull().default('pending'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    inputHash: text('input_hash'),
    input: jsonb('input').$type<Record<string, unknown>>(),
    output: jsonb('output').$type<Record<string, unknown>>(),
    tokens: jsonb('tokens').$type<{ input: number; output: number }>(),
    costUsd: decimal('cost_usd', { precision: 10, scale: 6 }),
    error: text('error'),
    createdById: uuid('created_by_id'),
    startedAt: timestamp('started_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('ai_analyses_lookup_idx').on(
      table.orgId,
      table.assessmentId,
      table.analysisType,
      table.audience,
    ),
    index('ai_analyses_input_hash_idx').on(table.inputHash),
  ],
);

export const aiAnalysesRelations = relations(aiAnalyses, ({ one }) => ({
  org: one(organizations, { fields: [aiAnalyses.orgId], references: [organizations.id] }),
  assessment: one(assessments, {
    fields: [aiAnalyses.assessmentId],
    references: [assessments.id],
  }),
}));

export type AiAnalysis = typeof aiAnalyses.$inferSelect;
export type NewAiAnalysis = typeof aiAnalyses.$inferInsert;
