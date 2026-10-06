import { integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { organizations } from './organizations';
import { subjects } from './academic';

/**
 * Línea de prueba dentro de una asignatura (M1 y M2 en Matemática, Biología en Ciencias,
 * Speaking en Inglés). Es la columna del tablero cuando una asignatura tiene más de una
 * prueba. `org_id` null = línea oficial y compartida; con valor, línea privada del colegio.
 *
 * `UNIQUE(id, subject_id)` existe para la FK compuesta de `instruments`: garantiza en el
 * motor que la línea de un instrumento pertenece a su misma asignatura.
 *
 * RLS en `packages/db/sql/rls-policies.sql` (mismo patrón que `performance_bands`).
 */
export const testTracks = pgTable(
  'test_tracks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').references(() => organizations.id),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    shortName: text('short_name').notNull(),
    order: integer('order').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('test_tracks_official_subject_code_uniq')
      .on(table.subjectId, table.code)
      .where(sql`${table.orgId} IS NULL`),
    uniqueIndex('test_tracks_org_subject_code_uniq')
      .on(table.orgId, table.subjectId, table.code)
      .where(sql`${table.orgId} IS NOT NULL`),
    unique('test_tracks_id_subject_uniq').on(table.id, table.subjectId),
  ],
);

export const testTracksRelations = relations(testTracks, ({ one }) => ({
  org: one(organizations, { fields: [testTracks.orgId], references: [organizations.id] }),
  subject: one(subjects, { fields: [testTracks.subjectId], references: [subjects.id] }),
}));

export type TestTrack = typeof testTracks.$inferSelect;
export type NewTestTrack = typeof testTracks.$inferInsert;
