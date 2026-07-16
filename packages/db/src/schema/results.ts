import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type { AnswerCount } from '@soe/types';
import { metricTypeEnum, performanceLevelEnum, statsSourceEnum } from './enums';
import { classGroups } from './academic';
import { assessments } from './assessments';
import { gradingScales, instruments } from './instruments';
import { items } from './items';
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
export const performanceBands = pgTable(
  'performance_bands',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Instrumento al que pertenece la banda. Nullable: las bandas pueden colgar
    // del instrumento (cortes oficiales por grado/forma, ej. DIA) o resolverse
    // vía la escala (`scaleId`). Un instrumento oficial (org_id NULL) con bandas
    // globales (org_id NULL) las comparte con todas las orgs que lo usan.
    instrumentId: uuid('instrument_id').references(() => instruments.id),
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
  },
  (table) => [index('performance_bands_instrument_order_idx').on(table.instrumentId, table.order)],
);

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

// ── Read-model de cohorte (analítica agregada) ───────────────────────────────
// Ver docs/plan-analitica-agregada-informes-oficiales.md.
//
// Existe para que la analítica por curso tenga UNA sola fuente de lectura, poblada
// por DOS escritores: el cálculo desde `responses` (calculador puro `aggregateItemStats`)
// y el importador de informes oficiales DIA (que no tiene respuestas por alumno).
//
// ⚠️ Guarda CONTEOS ENTEROS, nunca porcentajes. Dos razones, ambas verificadas:
//  1. Recombinar cohortes es una SUMA exacta (un profesor con N cursos, la referencia
//     org = todas las filas del assessment). Promediar porcentajes entre cursos de
//     distinto tamaño sería incorrecto.
//  2. El informe oficial entrega % + el N del curso, y `round(pct/100 * N)` reconstruye
//     el conteo exacto (suma exactamente N). Así lo importado es idéntico EN TIPO a lo
//     computado, y la paridad con el `GROUP BY` viejo es verificable fila a fila.
export const assessmentItemStats = pgTable(
  'assessment_item_stats',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    // Grano por curso. El scope de un profesor siempre se resuelve a una unión de
    // class_groups (nunca a una lista arbitraria de alumnos), por eso este grano
    // responde todas las consultas actuales.
    classGroupId: uuid('class_group_id')
      .notNull()
      .references(() => classGroups.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    // N de la cohorte considerada (el "Cantidad de estudiantes que considera este
    // informe" del PDF; los alumnos matriculados con resultados en el flujo computed).
    studentCount: integer('student_count').notNull(),
    // Denominador de correctRate. Equivale al `totalResponses` actual e incluye blancos.
    // Puede ser < studentCount si un alumno no tiene fila de respuesta para el ítem.
    responseCount: integer('response_count').notNull(),
    correctCount: integer('correct_count').notNull(),
    // [{ key, count, isCorrect }]. `key: null` = blanco/nulo (la opción "N" del informe).
    answerCounts: jsonb('answer_counts').$type<AnswerCount[]>().notNull().default([]),
    // Puntaje acumulado del curso en el ítem. Necesarios para derivar el % por eje,
    // que es ponderado por puntaje y admite crédito parcial (RPC del DIA = 0.5).
    scoreSum: decimal('score_sum', { precision: 9, scale: 2 }).notNull(),
    maxSum: decimal('max_sum', { precision: 9, scale: 2 }).notNull(),
    source: statsSourceEnum('source').notNull(),
    computedAt: timestamp('computed_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique().on(table.assessmentId, table.classGroupId, table.itemId),
    index('assessment_item_stats_item_idx').on(table.assessmentId, table.itemId),
  ],
);

// Read-model de cohorte por eje/habilidad. Alimenta dashboards `getSkills` y heatmap.
//
// ⚠️ `percentage` NO significa lo mismo según `source` (decisión §9.2 del plan):
//  · computed  → media de los porcentajes por alumno de `skill_results`. Se conserva
//                así deliberadamente para que los números ya publicados no se muevan.
//  · imported  → tasa agrupada ponderada por puntaje, derivada de assessment_item_stats.
//                Es la definición del propio DIA (reproduce el informe con error <0.01pp).
// Coinciden cuando todos los alumnos responden todos los ítems; divergen si faltan
// respuestas. Unificar a la tasa agrupada es más limpio pero cambiaría números vivos.
export const assessmentSkillStats = pgTable(
  'assessment_skill_stats',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    classGroupId: uuid('class_group_id')
      .notNull()
      .references(() => classGroups.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => taxonomyNodes.id, { onDelete: 'cascade' }),
    studentCount: integer('student_count').notNull(),
    correctCount: integer('correct_count').notNull(),
    totalCount: integer('total_count').notNull(),
    percentage: decimal('percentage', { precision: 5, scale: 2 }), // 0..100
    source: statsSourceEnum('source').notNull(),
    computedAt: timestamp('computed_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.assessmentId, table.classGroupId, table.nodeId)],
);

export const assessmentItemStatsRelations = relations(assessmentItemStats, ({ one }) => ({
  assessment: one(assessments, {
    fields: [assessmentItemStats.assessmentId],
    references: [assessments.id],
  }),
  classGroup: one(classGroups, {
    fields: [assessmentItemStats.classGroupId],
    references: [classGroups.id],
  }),
  item: one(items, { fields: [assessmentItemStats.itemId], references: [items.id] }),
}));

export const assessmentSkillStatsRelations = relations(assessmentSkillStats, ({ one }) => ({
  assessment: one(assessments, {
    fields: [assessmentSkillStats.assessmentId],
    references: [assessments.id],
  }),
  classGroup: one(classGroups, {
    fields: [assessmentSkillStats.classGroupId],
    references: [classGroups.id],
  }),
  node: one(taxonomyNodes, {
    fields: [assessmentSkillStats.nodeId],
    references: [taxonomyNodes.id],
  }),
}));

export const performanceBandsRelations = relations(performanceBands, ({ one }) => ({
  instrument: one(instruments, {
    fields: [performanceBands.instrumentId],
    references: [instruments.id],
  }),
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
export type AssessmentItemStat = typeof assessmentItemStats.$inferSelect;
export type NewAssessmentItemStat = typeof assessmentItemStats.$inferInsert;
export type AssessmentSkillStat = typeof assessmentSkillStats.$inferSelect;
export type NewAssessmentSkillStat = typeof assessmentSkillStats.$inferInsert;
