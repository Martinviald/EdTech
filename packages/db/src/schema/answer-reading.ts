import {
  type AnyPgColumn,
  boolean,
  check,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import type {
  ConsensusPolicy,
  NormalizedAnswer,
  ReaderSpec,
  ResponseFormat,
  ResponseFormatKind,
  ReviewReason,
  TranscriptionOutput,
  VisionProvider,
} from '@soe/types';
import {
  answerReadingConsentScopeEnum,
  answerReadingLabelSourceEnum,
  answerReadingModeEnum,
  answerReadingRunStatusEnum,
  answerReadingRunTriggerEnum,
  answerReadingSplitEnum,
  answerReviewActionEnum,
  answerReviewModeEnum,
  readingOutcomeEnum,
  readingRouteLevelEnum,
  readingRouteStatusEnum,
  readingStateEnum,
  scoringOutcomeEnum,
  transcriptionStatusEnum,
} from './enums';
import { organizations } from './organizations';
import { users } from './users';
import { students } from './students';
import { grades, subjects } from './academic';
import { instruments } from './instruments';
import { items } from './items';
import { files } from './files';
import { assessments } from './assessments';
import { responses } from './responses';
import { sheetScanBatches, sheetScanMarks } from './sheet-scanning';

/**
 * Lectura por visión de respuestas abiertas (diseño
 * docs/diseno-correccion-vision-preguntas-abiertas.md §9). El modelo SOLO
 * transcribe; el código normaliza, decide por consenso y corrige; lo dudoso va a
 * revisión humana. Las cinco tablas de datos llevan org_id NOT NULL + RLS
 * (packages/db/sql/rls-policies.sql): toda query corre en withOrgContext.
 * `reading_routes` es catálogo con org_id nullable (NULL = global), como
 * `llm_settings` / `decision_settings`.
 *
 * Disciplina de evidencia (CLAUDE.md §8.3): `answer_readings` no se actualiza
 * nunca (el RLS solo admite SELECT e INSERT); las decisiones y las revisiones se
 * reemplazan con una fila nueva y `superseded_by_id`, nunca se borran.
 */

/**
 * Regla de enrutamiento: QUÉ lectores, con qué prompt y qué política de consenso.
 * Inmutable en lo sustantivo: editar = fila nueva con `version + 1` y
 * `supersedes_id`; la anterior pasa a `retired`. Precedencia en ROUTE_MATCH_LEVELS;
 * en el mismo nivel, la fila de la org gana a la global.
 */
export const readingRoutes = pgTable(
  'reading_routes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** null = ruta global de plataforma; uuid = ruta propia de la org. */
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    status: readingRouteStatusEnum('status').default('shadow').notNull(),
    level: readingRouteLevelEnum('level').notNull(),
    itemId: uuid('item_id').references(() => items.id),
    instrumentId: uuid('instrument_id').references(() => instruments.id),
    formatKind: text('format_kind').$type<ResponseFormatKind>(),
    subjectId: uuid('subject_id').references(() => subjects.id),
    gradeId: uuid('grade_id').references(() => grades.id),
    readers: jsonb('readers').$type<ReaderSpec[]>().notNull(),
    fallbackReaders: jsonb('fallback_readers').$type<ReaderSpec[]>().default([]).notNull(),
    shadowReaders: jsonb('shadow_readers').$type<ReaderSpec[]>().default([]).notNull(),
    shadowSampleRate: decimal('shadow_sample_rate', { precision: 4, scale: 3 })
      .default('0')
      .notNull(),
    policy: jsonb('policy').$type<ConsensusPolicy>().notNull(),
    version: integer('version').default(1).notNull(),
    supersedesId: uuid('supersedes_id').references((): AnyPgColumn => readingRoutes.id),
    /** Quién la promovió a `active` y el informe del arnés que lo respaldó (§6.5). */
    notes: text('notes'),
    createdById: uuid('created_by_id').references(() => users.id),
    activatedById: uuid('activated_by_id').references(() => users.id),
    activatedAt: timestamp('activated_at'),
    retiredAt: timestamp('retired_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    // Cada nivel exige exactamente las columnas de alcance que le corresponden:
    // una ruta `item` sin item_id (o con un format_kind de más) nunca calzaría bien.
    check(
      'reading_routes_scope_matches_level',
      sql`CASE ${t.level}
        WHEN 'item' THEN ${t.itemId} IS NOT NULL AND ${t.instrumentId} IS NULL AND ${t.formatKind} IS NULL AND ${t.subjectId} IS NULL AND ${t.gradeId} IS NULL
        WHEN 'instrument' THEN ${t.itemId} IS NULL AND ${t.instrumentId} IS NOT NULL AND ${t.formatKind} IS NULL AND ${t.subjectId} IS NULL AND ${t.gradeId} IS NULL
        WHEN 'format_subject_grade' THEN ${t.itemId} IS NULL AND ${t.instrumentId} IS NULL AND ${t.formatKind} IS NOT NULL AND ${t.subjectId} IS NOT NULL AND ${t.gradeId} IS NOT NULL
        WHEN 'format_subject' THEN ${t.itemId} IS NULL AND ${t.instrumentId} IS NULL AND ${t.formatKind} IS NOT NULL AND ${t.subjectId} IS NOT NULL AND ${t.gradeId} IS NULL
        WHEN 'format' THEN ${t.itemId} IS NULL AND ${t.instrumentId} IS NULL AND ${t.formatKind} IS NOT NULL AND ${t.subjectId} IS NULL AND ${t.gradeId} IS NULL
        WHEN 'default' THEN ${t.itemId} IS NULL AND ${t.instrumentId} IS NULL AND ${t.formatKind} IS NULL AND ${t.subjectId} IS NULL AND ${t.gradeId} IS NULL
      END`,
    ),
    check(
      'reading_routes_shadow_sample_rate_range',
      sql`${t.shadowSampleRate} >= 0 AND ${t.shadowSampleRate} <= 1`,
    ),
    check('reading_routes_version_positive', sql`${t.version} >= 1`),
    // Una sola ruta ACTIVA por (dueño, alcance). Los NULL se colapsan con coalesce
    // porque un UNIQUE normal los trata como distintos (PG14 no tiene NULLS NOT DISTINCT).
    uniqueIndex('reading_routes_active_scope_uq')
      .on(
        sql`coalesce(${t.orgId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        t.level,
        sql`coalesce(${t.itemId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(${t.instrumentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(${t.formatKind}, '')`,
        sql`coalesce(${t.subjectId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(${t.gradeId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${t.status} = 'active'`),
    // Índices parciales de la resolución por nivel (sobre rutas no retiradas).
    index('reading_routes_item_idx')
      .on(t.itemId, t.orgId)
      .where(sql`${t.level} = 'item' AND ${t.status} <> 'retired'`),
    index('reading_routes_instrument_idx')
      .on(t.instrumentId, t.orgId)
      .where(sql`${t.level} = 'instrument' AND ${t.status} <> 'retired'`),
    index('reading_routes_format_idx')
      .on(t.formatKind, t.subjectId, t.gradeId, t.orgId)
      .where(
        sql`${t.level} IN ('format_subject_grade', 'format_subject', 'format') AND ${t.status} <> 'retired'`,
      ),
    index('reading_routes_default_idx')
      .on(t.orgId)
      .where(sql`${t.level} = 'default' AND ${t.status} <> 'retired'`),
  ],
);

/**
 * Una corrida del pipeline (por lote o reproceso). Polling desde el frontend
 * (CLAUDE.md §12). D2: arranca al procesar cada hoja, antes de confirmar el lote.
 */
export const answerReadingRuns = pgTable(
  'answer_reading_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    /** null en reprocesos manuales que no salen de un lote. */
    batchId: uuid('batch_id').references(() => sheetScanBatches.id),
    assessmentId: uuid('assessment_id').references(() => assessments.id),
    trigger: answerReadingRunTriggerEnum('trigger').notNull(),
    status: answerReadingRunStatusEnum('status').default('pending').notNull(),
    cropsTotal: integer('crops_total').default(0).notNull(),
    cropsDone: integer('crops_done').default(0).notNull(),
    autoAccepted: integer('auto_accepted').default(0).notNull(),
    needsReview: integer('needs_review').default(0).notNull(),
    costUsd: decimal('cost_usd', { precision: 10, scale: 6 }).default('0').notNull(),
    failureReason: text('failure_reason'),
    createdById: uuid('created_by_id').references(() => users.id),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('answer_reading_runs_batch_idx').on(t.orgId, t.batchId),
    index('answer_reading_runs_assessment_idx').on(t.orgId, t.assessmentId, t.createdAt),
    index('answer_reading_runs_status_idx').on(t.orgId, t.status),
  ],
);

/**
 * EVIDENCIA INMUTABLE: una fila por (recorte × lector × modo × intento). Nunca se
 * actualiza ni se borra (salvo en cascada con la marca). Idempotencia por
 * `reading_key` (hash opaco del recorte + lector + prompt, §7.3): reintentar es
 * una fila nueva con `attempt + 1`.
 */
export const answerReadings = pgTable(
  'answer_readings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => answerReadingRuns.id),
    markId: uuid('mark_id')
      .notNull()
      .references(() => sheetScanMarks.id, { onDelete: 'no action' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    cropFileId: uuid('crop_file_id').references(() => files.id),
    cropSha256: text('crop_sha256'),
    cropProfileId: text('crop_profile_id').notNull(),
    /** Snapshot del formato del layout con que se leyó. */
    responseFormat: jsonb('response_format').$type<ResponseFormat>().notNull(),
    readingKey: text('reading_key').notNull(),
    mode: answerReadingModeEnum('mode').notNull(),
    attempt: integer('attempt').default(1).notNull(),
    routeId: uuid('route_id').references(() => readingRoutes.id),
    routeVersion: integer('route_version'),
    readerKey: text('reader_key').notNull(),
    transcriberId: text('transcriber_id').notNull(),
    provider: text('provider').$type<VisionProvider>().notNull(),
    family: text('family').notNull(),
    /** Modelo pedido (de la ruta). */
    model: text('model').notNull(),
    /** Modelo que reportó el proveedor en la respuesta (puede diferir del pedido). */
    providerModel: text('provider_model'),
    promptRef: text('prompt_ref').notNull(),
    promptHash: text('prompt_hash').notNull(),
    outputSchemaId: text('output_schema_id').notNull(),
    params: jsonb('params').$type<ReaderSpec['params']>().notNull(),
    status: transcriptionStatusEnum('status').notNull(),
    output: jsonb('output').$type<TranscriptionOutput>(),
    readingState: readingStateEnum('reading_state'),
    literal: text('literal'),
    confidence: decimal('confidence', { precision: 4, scale: 3 }),
    /** Solo cuando la salida no validó (`invalid_output`), para depurar. */
    rawText: text('raw_text'),
    normalized: jsonb('normalized').$type<NormalizedAnswer>(),
    inputTokens: integer('input_tokens').default(0).notNull(),
    outputTokens: integer('output_tokens').default(0).notNull(),
    reasoningTokens: integer('reasoning_tokens').default(0).notNull(),
    cachedInputTokens: integer('cached_input_tokens').default(0).notNull(),
    imageTokens: integer('image_tokens'),
    costUsd: decimal('cost_usd', { precision: 10, scale: 6 }).default('0').notNull(),
    latencyMs: integer('latency_ms'),
    errorCode: text('error_code'),
    providerBatchId: text('provider_batch_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('answer_readings_key_reader_mode_attempt_uq').on(
      t.orgId,
      t.readingKey,
      t.readerKey,
      t.mode,
      t.attempt,
    ),
    index('answer_readings_run_idx').on(t.orgId, t.runId),
    index('answer_readings_mark_idx').on(t.orgId, t.markId),
    index('answer_readings_prompt_created_idx').on(t.orgId, t.promptRef, t.createdAt),
    check('answer_readings_attempt_positive', sql`${t.attempt} >= 1`),
  ],
);

/**
 * Resultado de aplicar la política de consenso a un recorte. Una VIGENTE por
 * marca (`superseded_by_id IS NULL`); reevaluar (cambio de ruta o de política)
 * crea otra y apunta la anterior a la nueva. Nunca se borra.
 */
export const answerReadingDecisions = pgTable(
  'answer_reading_decisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => answerReadingRuns.id),
    markId: uuid('mark_id')
      .notNull()
      .references(() => sheetScanMarks.id, { onDelete: 'no action' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    assessmentId: uuid('assessment_id').references(() => assessments.id),
    /** Para consolidar en `responses`. NUNCA viaja al proveedor. */
    studentId: uuid('student_id').references(() => students.id),
    /** Se llena al consolidar en `responses`. */
    responseId: uuid('response_id').references(() => responses.id),
    outcome: readingOutcomeEnum('outcome').notNull(),
    /** `canonical` del valor de consenso; agrupa respuestas idénticas en la cola. */
    canonical: text('canonical'),
    value: jsonb('value').$type<NormalizedAnswer>(),
    scoringOutcome: scoringOutcomeEnum('scoring_outcome'),
    reasons: jsonb('reasons').$type<ReviewReason[]>().default([]).notNull(),
    reviewMode: answerReviewModeEnum('review_mode'),
    routeId: uuid('route_id').references(() => readingRoutes.id),
    routeVersion: integer('route_version'),
    policyId: text('policy_id').notNull(),
    policyVersion: integer('policy_version').notNull(),
    usedReadingIds: uuid('used_reading_ids')
      .array()
      .default(sql`'{}'::uuid[]`)
      .notNull(),
    /**
     * Sin FK a propósito: con el único parcial de la decisión vigente, reemplazar
     * exige generar el id nuevo en la app y, en UNA transacción, primero apuntar la
     * anterior (`superseded_by_id = idNuevo`) y después insertar la nueva. Con FK
     * ese orden fallaría, y el inverso choca con el único.
     */
    supersededById: uuid('superseded_by_id'),
    resolvedAt: timestamp('resolved_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('answer_reading_decisions_current_mark_uq')
      .on(t.orgId, t.markId)
      .where(sql`${t.supersededById} IS NULL`),
    // Cola de revisión por evaluación: decisiones vigentes por resultado.
    index('answer_reading_decisions_queue_idx')
      .on(t.orgId, t.assessmentId, t.outcome, t.itemId)
      .where(sql`${t.supersededById} IS NULL`),
    // Agrupación por (ítem, valor canónico) en la vista por grupo (§11.2).
    index('answer_reading_decisions_group_idx')
      .on(t.orgId, t.assessmentId, t.itemId, t.canonical)
      .where(sql`${t.supersededById} IS NULL AND ${t.outcome} = 'needs_review'`),
    index('answer_reading_decisions_mark_history_idx').on(t.orgId, t.markId, t.createdAt),
    index('answer_reading_decisions_run_idx').on(t.orgId, t.runId),
    index('answer_reading_decisions_response_idx').on(t.responseId),
  ],
);

/**
 * Decisiones humanas sobre una decisión de lectura. SOLO SE AGREGAN FILAS:
 * deshacer o corregir crea una revisión nueva y apunta la anterior a ella con
 * `superseded_by_id`. Una acción de grupo escribe una fila por decisión, todas con
 * el mismo `group_operation_id` (para deshacer en bloque).
 */
export const answerReviews = pgTable(
  'answer_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => answerReadingDecisions.id),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id),
    mode: answerReviewModeEnum('mode').notNull(),
    action: answerReviewActionEnum('action').notNull(),
    editedLiteral: text('edited_literal'),
    resultingCanonical: text('resulting_canonical'),
    resultingValue: jsonb('resulting_value').$type<NormalizedAnswer>(),
    reason: text('reason'),
    groupOperationId: uuid('group_operation_id'),
    /** Cuántas decisiones resolvió la acción de grupo de la que forma parte (1 = individual). */
    groupSize: integer('group_size').default(1).notNull(),
    supersededById: uuid('superseded_by_id').references((): AnyPgColumn => answerReviews.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('answer_reviews_decision_idx').on(t.orgId, t.decisionId),
    index('answer_reviews_group_operation_idx')
      .on(t.orgId, t.groupOperationId)
      .where(sql`${t.groupOperationId} IS NOT NULL`),
    index('answer_reviews_reviewer_created_idx').on(t.orgId, t.reviewerId, t.createdAt),
    check('answer_reviews_group_size_positive', sql`${t.groupSize} >= 1`),
  ],
);

/**
 * Dataset de evaluación (§11.4, §12). `crop_file_id` es una COPIA del recorte con
 * retención propia (§14.4). Por ahora solo `org_internal` (D7).
 */
export const answerReadingSamples = pgTable(
  'answer_reading_samples',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    decisionId: uuid('decision_id').references(() => answerReadingDecisions.id),
    reviewId: uuid('review_id').references(() => answerReviews.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    formatKind: text('format_kind').$type<ResponseFormatKind>().notNull(),
    subjectId: uuid('subject_id').references(() => subjects.id),
    gradeId: uuid('grade_id').references(() => grades.id),
    cropFileId: uuid('crop_file_id')
      .notNull()
      .references(() => files.id),
    cropSha256: text('crop_sha256'),
    cropProfileId: text('crop_profile_id'),
    labelState: readingStateEnum('label_state').notNull(),
    labelLiteral: text('label_literal').notNull(),
    labelCanonical: text('label_canonical'),
    labelSource: answerReadingLabelSourceEnum('label_source').notNull(),
    annotatorCount: integer('annotator_count').default(1).notNull(),
    split: answerReadingSplitEnum('split').notNull(),
    consentScope: answerReadingConsentScopeEnum('consent_scope').default('org_internal').notNull(),
    /** El código no supo interpretar la respuesta y el revisor la marcó correcta (§11.4). */
    needsNormalizerCase: boolean('needs_normalizer_case').default(false).notNull(),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('answer_reading_samples_split_format_idx')
      .on(t.orgId, t.split, t.formatKind)
      .where(sql`${t.deletedAt} IS NULL`),
    // El job que arma el dataset es idempotente: una muestra por revisión.
    uniqueIndex('answer_reading_samples_review_uq')
      .on(t.orgId, t.reviewId)
      .where(sql`${t.reviewId} IS NOT NULL`),
    index('answer_reading_samples_normalizer_idx')
      .on(t.orgId, t.formatKind)
      .where(sql`${t.needsNormalizerCase} AND ${t.deletedAt} IS NULL`),
  ],
);

export const readingRoutesRelations = relations(readingRoutes, ({ one }) => ({
  org: one(organizations, { fields: [readingRoutes.orgId], references: [organizations.id] }),
  item: one(items, { fields: [readingRoutes.itemId], references: [items.id] }),
  instrument: one(instruments, {
    fields: [readingRoutes.instrumentId],
    references: [instruments.id],
  }),
  subject: one(subjects, { fields: [readingRoutes.subjectId], references: [subjects.id] }),
  grade: one(grades, { fields: [readingRoutes.gradeId], references: [grades.id] }),
  supersedes: one(readingRoutes, {
    fields: [readingRoutes.supersedesId],
    references: [readingRoutes.id],
  }),
  createdBy: one(users, { fields: [readingRoutes.createdById], references: [users.id] }),
  activatedBy: one(users, { fields: [readingRoutes.activatedById], references: [users.id] }),
}));

export const answerReadingRunsRelations = relations(answerReadingRuns, ({ one, many }) => ({
  org: one(organizations, { fields: [answerReadingRuns.orgId], references: [organizations.id] }),
  batch: one(sheetScanBatches, {
    fields: [answerReadingRuns.batchId],
    references: [sheetScanBatches.id],
  }),
  assessment: one(assessments, {
    fields: [answerReadingRuns.assessmentId],
    references: [assessments.id],
  }),
  createdBy: one(users, { fields: [answerReadingRuns.createdById], references: [users.id] }),
  readings: many(answerReadings),
  decisions: many(answerReadingDecisions),
}));

export const answerReadingsRelations = relations(answerReadings, ({ one }) => ({
  org: one(organizations, { fields: [answerReadings.orgId], references: [organizations.id] }),
  run: one(answerReadingRuns, {
    fields: [answerReadings.runId],
    references: [answerReadingRuns.id],
  }),
  mark: one(sheetScanMarks, { fields: [answerReadings.markId], references: [sheetScanMarks.id] }),
  item: one(items, { fields: [answerReadings.itemId], references: [items.id] }),
  cropFile: one(files, { fields: [answerReadings.cropFileId], references: [files.id] }),
  route: one(readingRoutes, { fields: [answerReadings.routeId], references: [readingRoutes.id] }),
}));

export const answerReadingDecisionsRelations = relations(
  answerReadingDecisions,
  ({ one, many }) => ({
    org: one(organizations, {
      fields: [answerReadingDecisions.orgId],
      references: [organizations.id],
    }),
    run: one(answerReadingRuns, {
      fields: [answerReadingDecisions.runId],
      references: [answerReadingRuns.id],
    }),
    mark: one(sheetScanMarks, {
      fields: [answerReadingDecisions.markId],
      references: [sheetScanMarks.id],
    }),
    item: one(items, { fields: [answerReadingDecisions.itemId], references: [items.id] }),
    assessment: one(assessments, {
      fields: [answerReadingDecisions.assessmentId],
      references: [assessments.id],
    }),
    student: one(students, {
      fields: [answerReadingDecisions.studentId],
      references: [students.id],
    }),
    response: one(responses, {
      fields: [answerReadingDecisions.responseId],
      references: [responses.id],
    }),
    route: one(readingRoutes, {
      fields: [answerReadingDecisions.routeId],
      references: [readingRoutes.id],
    }),
    supersededBy: one(answerReadingDecisions, {
      fields: [answerReadingDecisions.supersededById],
      references: [answerReadingDecisions.id],
    }),
    reviews: many(answerReviews),
  }),
);

export const answerReviewsRelations = relations(answerReviews, ({ one }) => ({
  org: one(organizations, { fields: [answerReviews.orgId], references: [organizations.id] }),
  decision: one(answerReadingDecisions, {
    fields: [answerReviews.decisionId],
    references: [answerReadingDecisions.id],
  }),
  reviewer: one(users, { fields: [answerReviews.reviewerId], references: [users.id] }),
  supersededBy: one(answerReviews, {
    fields: [answerReviews.supersededById],
    references: [answerReviews.id],
  }),
}));

export const answerReadingSamplesRelations = relations(answerReadingSamples, ({ one }) => ({
  org: one(organizations, {
    fields: [answerReadingSamples.orgId],
    references: [organizations.id],
  }),
  decision: one(answerReadingDecisions, {
    fields: [answerReadingSamples.decisionId],
    references: [answerReadingDecisions.id],
  }),
  review: one(answerReviews, {
    fields: [answerReadingSamples.reviewId],
    references: [answerReviews.id],
  }),
  item: one(items, { fields: [answerReadingSamples.itemId], references: [items.id] }),
  subject: one(subjects, { fields: [answerReadingSamples.subjectId], references: [subjects.id] }),
  grade: one(grades, { fields: [answerReadingSamples.gradeId], references: [grades.id] }),
  cropFile: one(files, { fields: [answerReadingSamples.cropFileId], references: [files.id] }),
}));

export type ReadingRouteRow = typeof readingRoutes.$inferSelect;
export type NewReadingRouteRow = typeof readingRoutes.$inferInsert;
export type AnswerReadingRun = typeof answerReadingRuns.$inferSelect;
export type NewAnswerReadingRun = typeof answerReadingRuns.$inferInsert;
export type AnswerReadingRow = typeof answerReadings.$inferSelect;
export type NewAnswerReadingRow = typeof answerReadings.$inferInsert;
export type AnswerReadingDecision = typeof answerReadingDecisions.$inferSelect;
export type NewAnswerReadingDecision = typeof answerReadingDecisions.$inferInsert;
export type AnswerReview = typeof answerReviews.$inferSelect;
export type NewAnswerReview = typeof answerReviews.$inferInsert;
export type AnswerReadingSample = typeof answerReadingSamples.$inferSelect;
export type NewAnswerReadingSample = typeof answerReadingSamples.$inferInsert;
