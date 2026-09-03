import {
  bigint,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type { CaptureProfile, CaptureSessionCapture, LayoutSpec, PageQuality } from '@soe/types';
import {
  captureSessionStatusEnum,
  markReviewDecisionEnum,
  markStateEnum,
  sheetScanBatchStatusEnum,
  sheetScanStateEnum,
} from './enums';
import { organizations } from './organizations';
import { users } from './users';
import { students } from './students';
import { instruments } from './instruments';
import { classGroups } from './academic';
import { assessmentForms, assessments, importJobs } from './assessments';
import { files } from './files';

/**
 * Lector de marcas (E22) — hojas de respuesta propias: layout congelado,
 * tiradas de impresión, hojas físicas, lotes de escaneo, escaneos por página y
 * marcas con evidencia. Diseño completo en docs/diseno-lector-de-marcas/
 * (03-contratos.md §3.5). Las 6 tablas llevan org_id NOT NULL + política RLS en
 * packages/db/sql/rls-policies.sql (D16): las hojas escaneadas contienen el
 * nombre del alumno — dato sensible bajo Ley 19.628.
 */

/** Un LayoutSpec CONGELADO (D6). Inmutable: editar crea una fila nueva con version + 1. */
export const sheetLayouts = pgTable(
  'sheet_layouts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id),
    version: integer('version').notNull(),
    spec: jsonb('spec').$type<LayoutSpec>().notNull(),
    // Hash canónico (layoutHash de @soe/types). Viaja dentro del QR; un hash
    // distinto al escanear = instrumento editado tras imprimir = lote rechazado (G1).
    specHash: text('spec_hash').notNull(),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    orgInstrumentVersionUq: unique('sheet_layouts_org_instrument_version_uq').on(
      t.orgId,
      t.instrumentId,
      t.version,
    ),
    hashIdx: index('sheet_layouts_hash_idx').on(t.specHash),
  }),
);

/** Una tirada de impresión: layout congelado × curso, con sus hojas de reserva (G8). */
export const sheetPrintRuns = pgTable(
  'sheet_print_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    layoutId: uuid('layout_id')
      .notNull()
      .references(() => sheetLayouts.id),
    classGroupId: uuid('class_group_id').references(() => classGroups.id),
    assessmentId: uuid('assessment_id').references(() => assessments.id),
    assessmentFormId: uuid('assessment_form_id').references(() => assessmentForms.id),
    spareCount: integer('spare_count').default(0).notNull(),
    sheetCount: integer('sheet_count').notNull(),
    pdfFileId: uuid('pdf_file_id').references(() => files.id),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    formIdx: index('sheet_print_runs_form_idx').on(t.assessmentFormId),
  }),
);

/**
 * Una HOJA FÍSICA. studentId NULL = hoja de reserva (G8).
 *
 * shortCode: entero de 32 bits único por org, aleatorio con reintento; viaja en
 * el QR corto (doc 07 §4.1) en vez del UUID + hash — 14 caracteres alfanuméricos
 * fuerzan un QR versión 1 con módulos 76% más grandes, fuera de la zona de
 * aliasing del escáner. NULL solo en hojas impresas antes del formato corto:
 * esas se resuelven por su QR legado con el id completo.
 */
export const printedSheets = pgTable(
  'printed_sheets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    printRunId: uuid('print_run_id')
      .notNull()
      .references(() => sheetPrintRuns.id),
    studentId: uuid('student_id').references(() => students.id),
    sequence: integer('sequence').notNull(),
    shortCode: bigint('short_code', { mode: 'number' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    runIdx: index('printed_sheets_run_idx').on(t.orgId, t.printRunId),
    runSequenceUq: unique('printed_sheets_run_sequence_uq').on(t.printRunId, t.sequence),
    orgShortCodeUq: uniqueIndex('printed_sheets_org_short_code_uq').on(t.orgId, t.shortCode),
  }),
);

/** Un lote subido. Unidad de trabajo del JobDispatcher (D12); polling desde el frontend. */
export const sheetScanBatches = pgTable('sheet_scan_batches', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  printRunId: uuid('print_run_id')
    .notNull()
    .references(() => sheetPrintRuns.id),
  status: sheetScanBatchStatusEnum('status').default('pending').notNull(),
  captureProfile: jsonb('capture_profile').$type<CaptureProfile>().notNull(),
  sourceFileIds: jsonb('source_file_ids').$type<string[]>().notNull(),
  pagesTotal: integer('pages_total'),
  pagesRead: integer('pages_read').default(0).notNull(),
  reviewPending: integer('review_pending').default(0).notNull(),
  // Estado de dominio, no excepción: motivo de `failed` (infra, reintentable) o
  // `rejected` (hash de layout distinto — G1, ningún reintento lo arregla).
  failureReason: text('failure_reason'),
  importJobId: uuid('import_job_id').references(() => importJobs.id),
  createdById: uuid('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * El escaneo de UNA PÁGINA de una hoja. Idempotente por (printedSheetId,
 * pageIndex, imageHash) — D13: re-escanear reemplaza (superseded), nunca borra.
 * pageIndex = página LÓGICA de la hoja (del QR); sourcePageIndex = posición en
 * el archivo subido, para poder decir "re-escanea la página 3 del PDF X".
 */
export const sheetScans = pgTable(
  'sheet_scans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => sheetScanBatches.id),
    printedSheetId: uuid('printed_sheet_id').references(() => printedSheets.id),
    pageIndex: integer('page_index').notNull(),
    sourceFileId: uuid('source_file_id').references(() => files.id),
    sourcePageIndex: integer('source_page_index'),
    imageHash: text('image_hash').notNull(),
    state: sheetScanStateEnum('state').notNull(),
    quality: jsonb('quality').$type<PageQuality>().notNull(),
    resolvedStudentId: uuid('resolved_student_id').references(() => students.id),
    identityConfidence: decimal('identity_confidence', { precision: 4, scale: 3 }),
    identityEvidence: jsonb('identity_evidence').$type<Record<string, unknown>>(),
    thumbFileId: uuid('thumb_file_id').references(() => files.id),
    supersedesId: uuid('supersedes_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    sheetPageHashUq: unique('sheet_scans_sheet_page_hash_uq').on(
      t.printedSheetId,
      t.pageIndex,
      t.imageHash,
    ),
    batchIdx: index('sheet_scans_batch_idx').on(t.orgId, t.batchId),
  }),
);

/**
 * Una marca leída, con su evidencia (D11: fill, threshold, margin y recorte).
 * Disciplina ai/human de CLAUDE.md §8.3: `value` es lo que leyó la máquina y
 * NUNCA se sobrescribe; `reviewDecision` + `reviewedValue` son lo que decidió el
 * humano. `reviewDecision` distingue las tres decisiones posibles: `option` (con
 * su `reviewedValue`), `blank` (el alumno no respondió) y `annulled` (respondió,
 * pero la respuesta se anula por regla de la prueba). `blank` y `annulled` dejan
 * `reviewedValue` en NULL: sin la columna de decisión serían indistinguibles.
 */
export const sheetScanMarks = pgTable(
  'sheet_scan_marks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    scanId: uuid('scan_id')
      .notNull()
      .references(() => sheetScans.id, { onDelete: 'cascade' }),
    fieldId: text('field_id').notNull(),
    printedNumber: text('printed_number').notNull(),
    state: markStateEnum('state').notNull(),
    value: text('value'),
    fill: decimal('fill', { precision: 4, scale: 3 }).notNull(),
    threshold: decimal('threshold', { precision: 4, scale: 3 }).notNull(),
    margin: decimal('margin', { precision: 6, scale: 3 }).notNull(),
    cropFileId: uuid('crop_file_id').references(() => files.id),
    reviewedValue: text('reviewed_value'),
    reviewDecision: markReviewDecisionEnum('review_decision'),
    reviewedById: uuid('reviewed_by_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at'),
  },
  (t) => ({
    scanFieldUq: unique('sheet_scan_marks_scan_field_uq').on(t.scanId, t.fieldId),
    reviewIdx: index('sheet_scan_marks_review_idx').on(t.orgId, t.scanId, t.state),
  }),
);

/**
 * Sesión de captura remota (E22-R, CD-16): empareja un teléfono SIN login con
 * un lote vía QR. El secreto jamás se persiste en claro (sólo su sha256); el
 * teléfono lo canjea por un capture token acotado a ESTA sesión (CD-18). El
 * lote asociado nace junto con la sesión y las fotos aceptadas se agregan de a
 * una a `sourceFileIds` (CD-19). `captures` es evidencia para el live view del
 * PC (identidades leídas por el gate), no la resolución autoritativa — esa
 * ocurre en /v1/read al procesar el lote.
 */
export const captureSessions = pgTable(
  'capture_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    printRunId: uuid('print_run_id')
      .notNull()
      .references(() => sheetPrintRuns.id),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => sheetScanBatches.id),
    status: captureSessionStatusEnum('status').default('pending').notNull(),
    secretHash: text('secret_hash').notNull(),
    redeemCount: integer('redeem_count').default(0).notNull(),
    captures: jsonb('captures').$type<CaptureSessionCapture[]>().default([]).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    orgStatusIdx: index('capture_sessions_org_status_idx').on(t.orgId, t.status, t.expiresAt),
    batchIdx: index('capture_sessions_batch_idx').on(t.batchId),
  }),
);

export const sheetLayoutsRelations = relations(sheetLayouts, ({ one, many }) => ({
  org: one(organizations, { fields: [sheetLayouts.orgId], references: [organizations.id] }),
  instrument: one(instruments, { fields: [sheetLayouts.instrumentId], references: [instruments.id] }),
  createdBy: one(users, { fields: [sheetLayouts.createdById], references: [users.id] }),
  printRuns: many(sheetPrintRuns),
}));

export const sheetPrintRunsRelations = relations(sheetPrintRuns, ({ one, many }) => ({
  org: one(organizations, { fields: [sheetPrintRuns.orgId], references: [organizations.id] }),
  layout: one(sheetLayouts, { fields: [sheetPrintRuns.layoutId], references: [sheetLayouts.id] }),
  classGroup: one(classGroups, { fields: [sheetPrintRuns.classGroupId], references: [classGroups.id] }),
  assessment: one(assessments, { fields: [sheetPrintRuns.assessmentId], references: [assessments.id] }),
  assessmentForm: one(assessmentForms, {
    fields: [sheetPrintRuns.assessmentFormId],
    references: [assessmentForms.id],
  }),
  pdfFile: one(files, { fields: [sheetPrintRuns.pdfFileId], references: [files.id] }),
  sheets: many(printedSheets),
  batches: many(sheetScanBatches),
}));

export const printedSheetsRelations = relations(printedSheets, ({ one, many }) => ({
  org: one(organizations, { fields: [printedSheets.orgId], references: [organizations.id] }),
  printRun: one(sheetPrintRuns, { fields: [printedSheets.printRunId], references: [sheetPrintRuns.id] }),
  student: one(students, { fields: [printedSheets.studentId], references: [students.id] }),
  scans: many(sheetScans),
}));

export const sheetScanBatchesRelations = relations(sheetScanBatches, ({ one, many }) => ({
  org: one(organizations, { fields: [sheetScanBatches.orgId], references: [organizations.id] }),
  printRun: one(sheetPrintRuns, { fields: [sheetScanBatches.printRunId], references: [sheetPrintRuns.id] }),
  importJob: one(importJobs, { fields: [sheetScanBatches.importJobId], references: [importJobs.id] }),
  scans: many(sheetScans),
}));

export const sheetScansRelations = relations(sheetScans, ({ one, many }) => ({
  org: one(organizations, { fields: [sheetScans.orgId], references: [organizations.id] }),
  batch: one(sheetScanBatches, { fields: [sheetScans.batchId], references: [sheetScanBatches.id] }),
  printedSheet: one(printedSheets, { fields: [sheetScans.printedSheetId], references: [printedSheets.id] }),
  resolvedStudent: one(students, { fields: [sheetScans.resolvedStudentId], references: [students.id] }),
  marks: many(sheetScanMarks),
}));

export const sheetScanMarksRelations = relations(sheetScanMarks, ({ one }) => ({
  org: one(organizations, { fields: [sheetScanMarks.orgId], references: [organizations.id] }),
  scan: one(sheetScans, { fields: [sheetScanMarks.scanId], references: [sheetScans.id] }),
  reviewedBy: one(users, { fields: [sheetScanMarks.reviewedById], references: [users.id] }),
}));

export const captureSessionsRelations = relations(captureSessions, ({ one }) => ({
  org: one(organizations, { fields: [captureSessions.orgId], references: [organizations.id] }),
  printRun: one(sheetPrintRuns, {
    fields: [captureSessions.printRunId],
    references: [sheetPrintRuns.id],
  }),
  batch: one(sheetScanBatches, {
    fields: [captureSessions.batchId],
    references: [sheetScanBatches.id],
  }),
  createdBy: one(users, { fields: [captureSessions.createdById], references: [users.id] }),
}));

export type SheetLayout = typeof sheetLayouts.$inferSelect;
export type NewSheetLayout = typeof sheetLayouts.$inferInsert;
export type SheetPrintRun = typeof sheetPrintRuns.$inferSelect;
export type NewSheetPrintRun = typeof sheetPrintRuns.$inferInsert;
export type PrintedSheet = typeof printedSheets.$inferSelect;
export type NewPrintedSheet = typeof printedSheets.$inferInsert;
export type SheetScanBatch = typeof sheetScanBatches.$inferSelect;
export type NewSheetScanBatch = typeof sheetScanBatches.$inferInsert;
export type SheetScan = typeof sheetScans.$inferSelect;
export type NewSheetScan = typeof sheetScans.$inferInsert;
export type SheetScanMark = typeof sheetScanMarks.$inferSelect;
export type NewSheetScanMark = typeof sheetScanMarks.$inferInsert;
export type CaptureSession = typeof captureSessions.$inferSelect;
export type NewCaptureSession = typeof captureSessions.$inferInsert;
