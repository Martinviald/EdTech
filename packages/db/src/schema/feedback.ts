import { index, pgTable, text, timestamp, uuid, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type { FeedbackContext } from '@soe/types';
import { feedbackStatusEnum, feedbackTypeEnum } from './enums';
import { organizations } from './organizations';
import { users } from './users';
import { files } from './files';

/**
 * Comentarios que las personas usuarias envían desde el widget in-app.
 *
 * El valor de la tabla no está en `message` (texto libre, siempre lo hubo en un
 * correo) sino en `context`: la URL, el rol activo y la vista donde ocurrió la
 * fricción se capturan solos. Eso es lo que convierte un comentario suelto en un
 * ticket accionable, y lo que un Excel compartido nunca puede dar.
 *
 * - `context` es JSONB deliberadamente (§5.4): sus campos varían por vista y
 *   crecerán sin migración. Su forma se valida con Zod en la capa de aplicación.
 * - `screenshot_file_id` apunta a la tabla genérica `files` (S3 vía presigned).
 * - `status` deja el triage dentro de la plataforma, sin exportar a otra herramienta.
 * - RLS por org_id — ver packages/db/sql/rls-policies.sql.
 */
export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // Quién lo envió. `set null` para no perder el comentario si el usuario se da
    // de baja: el contenido sigue siendo válido aunque el autor ya no esté.
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    type: feedbackTypeEnum('type').notNull(),
    status: feedbackStatusEnum('status').default('new').notNull(),
    message: text('message').notNull(),
    context: jsonb('context').$type<FeedbackContext>().notNull(),
    screenshotFileId: uuid('screenshot_file_id').references(() => files.id, {
      onDelete: 'set null',
    }),
    // Notas del triage interno. Nunca se muestran a quien envió el comentario.
    internalNote: text('internal_note'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    orgCreatedIdx: index('feedback_org_created_idx').on(table.orgId, table.createdAt),
    orgStatusIdx: index('feedback_org_status_idx').on(table.orgId, table.status),
  }),
);

export const feedbackRelations = relations(feedback, ({ one }) => ({
  org: one(organizations, {
    fields: [feedback.orgId],
    references: [organizations.id],
  }),
  createdBy: one(users, {
    fields: [feedback.createdById],
    references: [users.id],
  }),
  screenshot: one(files, {
    fields: [feedback.screenshotFileId],
    references: [files.id],
  }),
}));

export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;
