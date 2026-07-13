import { decimal, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type { RemedialContent } from '@soe/types';
import { remedialMaterialTypeEnum, remedialMethodEnum, remedialStatusEnum } from './enums';
import { organizations } from './organizations';
import { assessments } from './assessments';
import { taxonomyNodes } from './taxonomy';

/**
 * Material remedial generado con IA (F2 S3 — E9). Tabla POLIMÓRFICA: `type`
 * (guide | practice_set | group_plan) + `content JSONB` (Open/Closed — nuevos
 * tipos sin migración). Sirve a la vez de job async (status pending→processing→
 * ready/failed) y de registro del workflow de aprobación (ready→approved/discarded).
 *
 * - RLS por `org_id` (ver packages/db/sql/rls-policies.sql) — per-tenant. El reuso
 *   plataforma-global de material genérico por OA (cross-tenant) queda como
 *   optimización futura (requeriría org_id nullable + política de lectura compartida).
 * - La IA NUNCA recibe PII: para `group_plan` la agrupación de alumnos es
 *   determinista en backend; la IA solo etiqueta el grupo en abstracto.
 * - Los ítems de práctica (H9.3) se insertan en `items` con source='ai_generated'
 *   + status='draft'; `content` (practice_set) solo guarda sus referencias.
 * - Trazabilidad IA: `model`, `promptVersion`, `tokens`, `costUsd`, `input` (contexto
 *   curricular enviado, para auditoría). La salida vive solo en `content`.
 */
export const remedialMaterials = pgTable(
  'remedial_materials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    type: remedialMaterialTypeEnum('type').notNull(),
    status: remedialStatusEnum('status').notNull().default('pending'),
    // Método de generación del set (Ola 2.1a). `self_contained` = default para no romper
    // filas viejas; `reuse_stimulus` (A) / `generate_stimulus` (B, 2.2).
    method: remedialMethodEnum('method').notNull().default('self_contained'),
    // Nodo de taxonomía objetivo (la brecha / OA a remediar).
    nodeId: uuid('node_id').references(() => taxonomyNodes.id, { onDelete: 'set null' }),
    // Evaluación de origen (la brecha proviene de su Análisis IA), opcional.
    assessmentId: uuid('assessment_id').references(() => assessments.id, { onDelete: 'set null' }),
    // Cohorte (para group_plan): curso sobre el que se agrupa, opcional.
    classGroupId: uuid('class_group_id'),
    // Análisis IA (brecha) de origen, opcional (sin FK dura: trazabilidad blanda).
    sourceAnalysisId: uuid('source_analysis_id'),
    title: text('title'),
    // Salida IA polimórfica por `type` (validada con Zod en la capa de aplicación).
    // §8.3: evidencia IA — inmutable tras `markReady`. La IA propone.
    content: jsonb('content').$type<RemedialContent>(),
    // Override humano (edición previa a la aprobación — TKT-17 c). §8.3: el humano
    // ajusta sin borrar la evidencia IA. Content EFECTIVO = editedContent ?? content.
    editedContent: jsonb('edited_content').$type<RemedialContent>(),
    // Reporte del juez automático (Ola 2.1b): { iterations, finalStatus, verdicts[] }.
    // Genérico por ahora — el `qualityReportSchema` dedicado llega en 2.1b; se agrega la
    // columna ya para que 2.1b solo la rellene. `null` en filas 2.1a / sin juez.
    qualityReport: jsonb('quality_report').$type<Record<string, unknown>>(),
    // Contexto curricular (RAG) enviado al modelo — auditoría, sin PII.
    input: jsonb('input').$type<Record<string, unknown>>(),
    inputHash: text('input_hash'), // caché por (type, nodeId, nivel, …)
    model: text('model'),
    promptVersion: text('prompt_version'),
    tokens: jsonb('tokens').$type<{ input: number; output: number }>(),
    costUsd: decimal('cost_usd', { precision: 10, scale: 6 }),
    error: text('error'),
    createdById: uuid('created_by_id'),
    reviewedById: uuid('reviewed_by_id'), // quién aprobó/descartó
    startedAt: timestamp('started_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
    reviewedAt: timestamp('reviewed_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('remedial_materials_lookup_idx').on(
      table.orgId,
      table.type,
      table.nodeId,
      table.status,
    ),
    index('remedial_materials_input_hash_idx').on(table.inputHash),
  ],
);

export const remedialMaterialsRelations = relations(remedialMaterials, ({ one }) => ({
  org: one(organizations, {
    fields: [remedialMaterials.orgId],
    references: [organizations.id],
  }),
  node: one(taxonomyNodes, {
    fields: [remedialMaterials.nodeId],
    references: [taxonomyNodes.id],
  }),
  assessment: one(assessments, {
    fields: [remedialMaterials.assessmentId],
    references: [assessments.id],
  }),
}));

export type RemedialMaterial = typeof remedialMaterials.$inferSelect;
export type NewRemedialMaterial = typeof remedialMaterials.$inferInsert;
