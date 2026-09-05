import { jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import {
  assessmentModeEnum,
  assessmentStatusEnum,
  dataGranularityEnum,
  importJobStatusEnum,
  importJobTypeEnum,
} from './enums';
import { organizations } from './organizations';
import { classGroups } from './academic';
import { instruments } from './instruments';
import { users } from './users';
import { students } from './students';

export const assessments = pgTable('assessments', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  instrumentId: uuid('instrument_id')
    .notNull()
    .references(() => instruments.id),
  name: text('name'),
  administeredById: uuid('administered_by_id').references(() => users.id),
  mode: assessmentModeEnum('mode').default('paper').notNull(),
  status: assessmentStatusEnum('status').default('scheduled').notNull(),
  // Granularidad del dato disponible. Columna tipada y no `config` JSONB porque se
  // ramifica y se filtra en SQL (CLAUDE.md §5.4). `item_level` por defecto: la
  // migración es inerte para todo lo existente.
  dataGranularity: dataGranularityEnum('data_granularity').default('item_level').notNull(),
  scheduledFor: timestamp('scheduled_for'),
  administeredAt: timestamp('administered_at'),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const assessmentCourseAssignments = pgTable(
  'assessment_course_assignments',
  {
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    classGroupId: uuid('class_group_id')
      .notNull()
      .references(() => classGroups.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.assessmentId, table.classGroupId] })],
);

/**
 * Una FORMA es una combinación concreta de secciones de un instrumento: el tronco común
 * más una de las ramas electivas. En una prueba sin electivas no hace falta ninguna.
 *
 * `orgId` es propio y no heredado: `assessment_form_students` liga alumnos con su electivo
 * (dato personal, Ley 19.628) y su política RLS necesita un `org_id` desde donde derivar el
 * aislamiento. Antes esta tabla no lo tenía y quedaba fuera del RLS.
 */
export const assessmentForms = pgTable('assessment_forms', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id')
    .notNull()
    .references(() => assessments.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Secciones que componen la forma: las `core` del instrumento + la electiva elegida. */
  sectionIds: uuid('section_ids').array(),
  /** Orden de impresión. ⚠️ Hoy no lo lee nadie; se conserva por contrato con el lector. */
  itemOrder: uuid('item_order').array(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Qué forma le toca a cada alumno. Existe ANTES de la primera respuesta: hay que saberla
 * para imprimir su hoja y para decidir qué ítems se le corrigen.
 *
 * No se resolvió con una columna en `assessment_results` porque ese registro se borra y
 * recrea al recalcular; ni sólo con `responses.form_id`, que es evidencia por respuesta y
 * no matrícula al electivo.
 */
export const assessmentFormStudents = pgTable(
  'assessment_form_students',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    assessmentFormId: uuid('assessment_form_id')
      .notNull()
      .references(() => assessmentForms.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('assessment_form_students_form_student_uq').on(table.assessmentFormId, table.studentId),
  ],
);

export const importJobs = pgTable('import_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id').references(() => assessments.id),
  type: importJobTypeEnum('type').notNull(),
  status: importJobStatusEnum('status').default('pending').notNull(),
  fileUrl: text('file_url'),
  mappingConfig: jsonb('mapping_config').$type<Record<string, unknown>>().default({}),
  result: jsonb('result').$type<{
    rowsProcessed?: number;
    errors?: number;
    warnings?: number;
  }>(),
  errorLog: jsonb('error_log').$type<Array<{ row: number; message: string }>>(),
  createdById: uuid('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

export const assessmentsRelations = relations(assessments, ({ one, many }) => ({
  org: one(organizations, { fields: [assessments.orgId], references: [organizations.id] }),
  instrument: one(instruments, {
    fields: [assessments.instrumentId],
    references: [instruments.id],
  }),
  administeredBy: one(users, {
    fields: [assessments.administeredById],
    references: [users.id],
  }),
  courseAssignments: many(assessmentCourseAssignments),
  forms: many(assessmentForms),
}));

export const assessmentCourseAssignmentsRelations = relations(
  assessmentCourseAssignments,
  ({ one }) => ({
    assessment: one(assessments, {
      fields: [assessmentCourseAssignments.assessmentId],
      references: [assessments.id],
    }),
    classGroup: one(classGroups, {
      fields: [assessmentCourseAssignments.classGroupId],
      references: [classGroups.id],
    }),
  }),
);

export const assessmentFormStudentsRelations = relations(assessmentFormStudents, ({ one }) => ({
  form: one(assessmentForms, {
    fields: [assessmentFormStudents.assessmentFormId],
    references: [assessmentForms.id],
  }),
  student: one(students, {
    fields: [assessmentFormStudents.studentId],
    references: [students.id],
  }),
}));

export const assessmentFormsRelations = relations(assessmentForms, ({ one }) => ({
  assessment: one(assessments, {
    fields: [assessmentForms.assessmentId],
    references: [assessments.id],
  }),
}));

export type Assessment = typeof assessments.$inferSelect;
export type NewAssessment = typeof assessments.$inferInsert;
export type AssessmentForm = typeof assessmentForms.$inferSelect;
export type NewAssessmentForm = typeof assessmentForms.$inferInsert;
export type ImportJob = typeof importJobs.$inferSelect;
export type NewImportJob = typeof importJobs.$inferInsert;
