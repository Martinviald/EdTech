import {
  boolean,
  decimal,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import {
  attachmentKindEnum,
  gradingScaleTypeEnum,
  instrumentStatusEnum,
  instrumentTypeEnum,
  passageFormatEnum,
  sectionTypeEnum,
} from './enums';
import { organizations } from './organizations';
import { grades, subjects } from './academic';
import { taxonomies } from './taxonomy';
import { users } from './users';

export const gradingScales = pgTable('grading_scales', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id),
  name: text('name').notNull(),
  type: gradingScaleTypeEnum('type').notNull(),
  minGrade: decimal('min_grade', { precision: 5, scale: 2 }).default('1.00').notNull(),
  maxGrade: decimal('max_grade', { precision: 5, scale: 2 }).default('7.00').notNull(),
  passingGrade: decimal('passing_grade', { precision: 5, scale: 2 }).default('4.00').notNull(),
  passingThreshold: decimal('passing_threshold', { precision: 3, scale: 2 })
    .default('0.60')
    .notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const instruments = pgTable('instruments', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id),
  taxonomyId: uuid('taxonomy_id').references(() => taxonomies.id),
  name: text('name').notNull(),
  shortName: text('short_name'),
  type: instrumentTypeEnum('type').notNull(),
  subjectId: uuid('subject_id').references(() => subjects.id),
  gradeId: uuid('grade_id').references(() => grades.id),
  year: integer('year'),
  version: text('version'),
  isOfficial: boolean('is_official').default(false).notNull(),
  status: instrumentStatusEnum('status').default('draft').notNull(),
  gradingScaleId: uuid('grading_scale_id').references(() => gradingScales.id),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  createdById: uuid('created_by_id').references(() => users.id),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const instrumentSections = pgTable('instrument_sections', {
  id: uuid('id').defaultRandom().primaryKey(),
  instrumentId: uuid('instrument_id')
    .notNull()
    .references(() => instruments.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: sectionTypeEnum('type').notNull(),
  order: integer('order').default(0).notNull(),
  maxPoints: decimal('max_points', { precision: 7, scale: 2 }),
  timeLimitMin: integer('time_limit_min'),
  instructions: text('instructions'),
  // ── Pasaje / texto base de la sección (comprensión lectora) ──
  passageTitle: text('passage_title'),
  passageText: text('passage_text'),
  passageFormat: passageFormatEnum('passage_format'), // null si la sección no tiene pasaje
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
});

// Adjunto a NIVEL DE INSTRUMENTO (TKT-15). Mismo patrón que `section_attachments`
// pero colgando del instrumento completo — su caso de uso principal es el PDF del
// enunciado / cuadernillo (`kind = 'pdf'`). El archivo se sube directo a S3 vía
// presigned URL (el backend NO lo recibe en memoria); aquí solo se persiste la
// metadata + `storage_key`. La regla "un PDF de enunciado por instrumento" se
// aplica en la capa de servicio (reemplazo del adjunto `pdf` existente), no como
// restricción de schema, para dejar el modelo extensible a otros kinds a futuro.
// NO es una tabla sensible (sin PII): hereda el aislamiento por org del instrumento
// padre (mismo criterio que `section_attachments`, que tampoco tiene RLS).
export const instrumentAttachments = pgTable('instrument_attachments', {
  id: uuid('id').defaultRandom().primaryKey(),
  instrumentId: uuid('instrument_id')
    .notNull()
    .references(() => instruments.id, { onDelete: 'cascade' }),
  kind: attachmentKindEnum('kind').notNull(),
  order: integer('order').default(0).notNull(),
  storageKey: text('storage_key'), // clave S3 (null mientras no se sube el archivo)
  url: text('url'), // url pública/externa opcional
  fileName: text('file_name'),
  mimeType: text('mime_type'),
  sizeBytes: integer('size_bytes'),
  note: text('note'),
  meta: jsonb('meta').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sectionAttachments = pgTable('section_attachments', {
  id: uuid('id').defaultRandom().primaryKey(),
  sectionId: uuid('section_id')
    .notNull()
    .references(() => instrumentSections.id, { onDelete: 'cascade' }),
  kind: attachmentKindEnum('kind').notNull(),
  order: integer('order').default(0).notNull(),
  storageKey: text('storage_key'), // clave S3 (null mientras no se sube el archivo)
  url: text('url'), // url pública/externa opcional
  fileName: text('file_name'),
  mimeType: text('mime_type'),
  sizeBytes: integer('size_bytes'),
  note: text('note'), // descripción (mapea `passage.attachments[].note` del JSON)
  meta: jsonb('meta').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const instrumentsRelations = relations(instruments, ({ one, many }) => ({
  org: one(organizations, { fields: [instruments.orgId], references: [organizations.id] }),
  taxonomy: one(taxonomies, {
    fields: [instruments.taxonomyId],
    references: [taxonomies.id],
  }),
  subject: one(subjects, { fields: [instruments.subjectId], references: [subjects.id] }),
  grade: one(grades, { fields: [instruments.gradeId], references: [grades.id] }),
  gradingScale: one(gradingScales, {
    fields: [instruments.gradingScaleId],
    references: [gradingScales.id],
  }),
  sections: many(instrumentSections),
  attachments: many(instrumentAttachments),
}));

export const instrumentAttachmentsRelations = relations(instrumentAttachments, ({ one }) => ({
  instrument: one(instruments, {
    fields: [instrumentAttachments.instrumentId],
    references: [instruments.id],
  }),
}));

export const instrumentSectionsRelations = relations(instrumentSections, ({ one, many }) => ({
  instrument: one(instruments, {
    fields: [instrumentSections.instrumentId],
    references: [instruments.id],
  }),
  attachments: many(sectionAttachments),
}));

export const sectionAttachmentsRelations = relations(sectionAttachments, ({ one }) => ({
  section: one(instrumentSections, {
    fields: [sectionAttachments.sectionId],
    references: [instrumentSections.id],
  }),
}));

export type GradingScale = typeof gradingScales.$inferSelect;
export type NewGradingScale = typeof gradingScales.$inferInsert;
export type Instrument = typeof instruments.$inferSelect;
export type NewInstrument = typeof instruments.$inferInsert;
export type InstrumentSection = typeof instrumentSections.$inferSelect;
export type NewInstrumentSection = typeof instrumentSections.$inferInsert;
export type SectionAttachment = typeof sectionAttachments.$inferSelect;
export type NewSectionAttachment = typeof sectionAttachments.$inferInsert;
export type InstrumentAttachment = typeof instrumentAttachments.$inferSelect;
export type NewInstrumentAttachment = typeof instrumentAttachments.$inferInsert;
