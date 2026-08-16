import { index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type { DocumentBrandingSnapshot, DocumentContent, DocumentSource } from '@soe/types';
import { documentStatusEnum, documentTypeEnum, documentVisibilityEnum } from './enums';
import { organizations } from './organizations';
import { users } from './users';
import { grades, subjects } from './academic';
import { taxonomyNodes } from './taxonomy';
import { instruments } from './instruments';
import { items } from './items';

/**
 * Editor de Materiales — documento por bloques (docs/propuesta-editor-materiales.md).
 * Capa de AUTORÍA/presentación sobre el backbone de medición: los bloques `item`
 * de `content` referencian filas vivas de `items` y la medición pasa por la
 * promoción opt-in a `instruments` (columna instrument_id, Decisión G2). No
 * duplica analítica ni modelo de ítems.
 *
 * - `content` = envelope versionado `{ version, blocks }` (Zod: documentContentSchema
 *   en @soe/types). Un tipo de bloque nuevo NO requiere migración (Open/Closed).
 * - `org_id` NULLABLE: filas con NULL son material de PLATAFORMA (plantillas
 *   cross-colegio, Decisión B) — mismo criterio que `files`/`performance_bands`.
 * - Fork unidireccional (Decisión C): `source` guarda el backref al remedial /
 *   instrumento / documento del que se copió; nunca se re-sincroniza solo.
 * - Compartir = copy-on-use (duplicar), nunca editar el original de otro. La
 *   autorización fina (dueño vs visibility) vive en el service, no acá.
 * - RLS por org_id con excepción org_id IS NULL (ver packages/db/sql/rls-policies.sql).
 */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    createdById: uuid('created_by_id').references(() => users.id),
    title: text('title').notNull(),
    type: documentTypeEnum('type').notNull(),
    status: documentStatusEnum('status').default('draft').notNull(),
    visibility: documentVisibilityEnum('visibility').default('org').notNull(),
    subjectId: uuid('subject_id').references(() => subjects.id),
    gradeId: uuid('grade_id').references(() => grades.id),
    // OA/habilidad principal a nivel documento (guías sin ítems). La cobertura
    // taxonómica fina de documentos con ítems se deriva de item_taxonomy_tags.
    nodeId: uuid('node_id').references(() => taxonomyNodes.id, { onDelete: 'set null' }),
    // Binding de medición (Decisión G2): NULL hasta promote-to-instrument. Una
    // guía de trabajo nunca lo llena; un documento aplicado/medible sí.
    instrumentId: uuid('instrument_id').references(() => instruments.id, {
      onDelete: 'set null',
    }),
    content: jsonb('content')
      .$type<DocumentContent>()
      .notNull()
      .default({ version: 1, blocks: [] }),
    source: jsonb('source')
      .$type<DocumentSource>()
      .notNull()
      .default({ kind: 'blank', refId: null }),
    // Snapshot del branding al publicar/exportar (estabilidad del impreso). El
    // render por defecto usa el branding VIVO de organizations.config.branding.
    branding: jsonb('branding').$type<DocumentBrandingSnapshot>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('documents_lookup_idx').on(table.orgId, table.type, table.status),
    index('documents_created_by_idx').on(table.createdById),
  ],
);

/**
 * Índice normalizado de referencias documento→ítem (Decisión A3). Los bloques
 * viven en documents.content (JSONB, fuente de verdad); esta tabla se RECALCULA
 * al guardar y responde en SQL "¿qué documentos usan el ítem X?" (deprecación de
 * ítems, métricas de reutilización) sin escanear JSONB.
 */
export const documentItemRefs = pgTable(
  'document_item_refs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Espeja documents.org_id (nullable) para que el RLS aplique igual.
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique().on(table.documentId, table.itemId),
    index('document_item_refs_item_idx').on(table.itemId),
  ],
);

export const documentsRelations = relations(documents, ({ one, many }) => ({
  org: one(organizations, { fields: [documents.orgId], references: [organizations.id] }),
  createdBy: one(users, { fields: [documents.createdById], references: [users.id] }),
  subject: one(subjects, { fields: [documents.subjectId], references: [subjects.id] }),
  grade: one(grades, { fields: [documents.gradeId], references: [grades.id] }),
  node: one(taxonomyNodes, { fields: [documents.nodeId], references: [taxonomyNodes.id] }),
  instrument: one(instruments, {
    fields: [documents.instrumentId],
    references: [instruments.id],
  }),
  itemRefs: many(documentItemRefs),
}));

export const documentItemRefsRelations = relations(documentItemRefs, ({ one }) => ({
  document: one(documents, {
    fields: [documentItemRefs.documentId],
    references: [documents.id],
  }),
  item: one(items, { fields: [documentItemRefs.itemId], references: [items.id] }),
}));

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentItemRef = typeof documentItemRefs.$inferSelect;
export type NewDocumentItemRef = typeof documentItemRefs.$inferInsert;
