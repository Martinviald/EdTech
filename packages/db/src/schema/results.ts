import {
  boolean,
  decimal,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { metricTypeEnum, performanceLevelEnum } from './enums';
import { assessments } from './assessments';
import { gradingScales } from './instruments';
import { organizations } from './organizations';
import { students } from './students';
import { taxonomyNodes } from './taxonomy';

// ── Bandas de desempeño configurables (#2) ───────────────────────────────────
// Reemplaza el enum cerrado de 4 niveles (`performance_level`) por datos. Cada
// banda pertenece a una escala (`scaleId`) y/o a una organización (`orgId`), y
// define su rango [minThreshold, maxThreshold] sobre el % de logro (0..1). Esto
// modela SIMCE (3), Cambridge CEFR (6), stanine (9), o cualquier N de bandas sin
// migración de schema. El enum `performance_level` se mantiene como fallback
// deprecated en assessment_results/skill_results (soft migration).
export const performanceBands = pgTable('performance_bands', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Escala a la que pertenece la banda. Nullable: permite catálogos por org
  // (orgId) no atados a una escala concreta.
  scaleId: uuid('scale_id').references(() => gradingScales.id, { onDelete: 'cascade' }),
  // Tenant dueño de la banda (multi-tenancy). Nullable para bandas globales
  // de plataforma (ej. catálogo DIA por defecto).
  orgId: uuid('org_id').references(() => organizations.id),
  // Clave estable legible (ej. 'A1', 'insufficient', 'nivel_1').
  key: text('key').notNull(),
  // Etiqueta presentable (ej. 'A1 — Beginner', 'Insuficiente').
  label: text('label').notNull(),
  // Orden de menor a mayor logro.
  order: integer('order').default(0).notNull(),
  // Rango sobre el % de logro (0..1). Inclusivo en min, exclusivo en max.
  minThreshold: decimal('min_threshold', { precision: 5, scale: 4 }).notNull(),
  maxThreshold: decimal('max_threshold', { precision: 5, scale: 4 }).notNull(),
  // Color de presentación (token o hex). Nullable.
  color: text('color'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  // Soft delete (§5.1): las bandas son configuración editable por tenant; al
  // retirar una banda se marca deleted_at en vez de DELETE. Las lecturas deben
  // filtrar `deleted_at IS NULL` por defecto.
  deletedAt: timestamp('deleted_at'),
});

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
    // Métrica raíz extendida (#3). Default 'percentage' preserva el flujo DIA.
    metricType: metricTypeEnum('metric_type').default('percentage').notNull(),
    // Puntaje escalado (PAES 150–1000, IRT, stanine). Nullable.
    scaledScore: decimal('scaled_score', { precision: 7, scale: 2 }),
    // Etiqueta de banda (Cambridge CEFR, etc.). Nullable.
    bandLabel: text('band_label'),
    // Nivel de desempeño como dato (#2). FK nullable a performance_bands.
    performanceBandId: uuid('performance_band_id').references(() => performanceBands.id),
    // DEPRECATED (soft migration): enum cerrado de 4 niveles. Se mantiene como
    // fallback para no romper datos/queries existentes. Nuevos cálculos pueblan
    // además performanceBandId cuando hay bandas configuradas.
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
    // Nivel de desempeño como dato (#2). FK nullable a performance_bands.
    performanceBandId: uuid('performance_band_id').references(() => performanceBands.id),
    // DEPRECATED (soft migration): ver assessment_results.performanceLevel.
    performanceLevel: performanceLevelEnum('performance_level'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.assessmentId, table.studentId, table.nodeId)],
);

export const performanceBandsRelations = relations(performanceBands, ({ one }) => ({
  scale: one(gradingScales, {
    fields: [performanceBands.scaleId],
    references: [gradingScales.id],
  }),
  org: one(organizations, {
    fields: [performanceBands.orgId],
    references: [organizations.id],
  }),
}));

export const assessmentResultsRelations = relations(assessmentResults, ({ one }) => ({
  assessment: one(assessments, {
    fields: [assessmentResults.assessmentId],
    references: [assessments.id],
  }),
  student: one(students, { fields: [assessmentResults.studentId], references: [students.id] }),
  performanceBand: one(performanceBands, {
    fields: [assessmentResults.performanceBandId],
    references: [performanceBands.id],
  }),
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
  performanceBand: one(performanceBands, {
    fields: [skillResults.performanceBandId],
    references: [performanceBands.id],
  }),
}));

export type PerformanceBand = typeof performanceBands.$inferSelect;
export type NewPerformanceBand = typeof performanceBands.$inferInsert;
export type AssessmentResult = typeof assessmentResults.$inferSelect;
export type NewAssessmentResult = typeof assessmentResults.$inferInsert;
export type SkillResult = typeof skillResults.$inferSelect;
export type NewSkillResult = typeof skillResults.$inferInsert;
