import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { fileStatusEnum } from './enums';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Módulo genérico de almacenamiento (`files`). Registro FUENTE DE VERDAD de todo
 * objeto subido a S3 en la plataforma: hoy el PDF del enunciado de instrumentos
 * (TKT-15) y, a futuro, hojas de respuesta, material remedial, imágenes de ítems,
 * audios de listening, etc. Es infraestructura desacoplada: no conoce la lógica de
 * ningún dominio.
 *
 * El archivo se sube DIRECTO a S3 vía presigned URL (el backend nunca lo recibe en
 * memoria, CLAUDE.md §11); aquí sólo se persiste la metadata + `storage_key`. El
 * ciclo de vida es `pending` (URL emitida) → `ready` (subida confirmada y validada
 * con headObject). El borrado es soft-delete (`deleted_at`) + delete real del objeto
 * en S3 (lo orquesta `FilesService`, así no quedan huérfanos).
 *
 * Multi-tenant: `org_id` NULLABLE. Las filas con `org_id IS NULL` son archivos
 * GLOBALES / de plataforma (ej. el PDF de un instrumento OFICIAL, que no pertenece a
 * ningún colegio), visibles para todos los tenants — mismo criterio que
 * `performance_bands` / `llm_settings`. RLS ACTIVO (ver packages/db/sql/rls-policies.sql):
 * toda query de tenant corre dentro de `withOrgContext(orgId)`; las filas globales se
 * leen/escriben sin contexto (`org_id IS NULL`). Sin contexto ⇒ sólo se ven globales.
 *
 * Asociación polimórfica OPCIONAL (`owner_type` / `owner_id` / `purpose`): permite a
 * cualquier dominio adjuntar archivos sin crear una tabla-enlace por dominio. La
 * autoridad de negocio (permisos, reglas tipo "1 archivo por entidad") vive en el
 * service del dominio consumidor, no en esta tabla.
 */
export const files = pgTable(
  'files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // NULLABLE: null = archivo global/de plataforma (ej. instrumento oficial).
    orgId: uuid('org_id').references(() => organizations.id),
    status: fileStatusEnum('status').default('pending').notNull(),
    // Clave del objeto en S3 (única a nivel lógico). NOT NULL: se conoce al emitir
    // la URL de subida, antes de confirmar.
    storageKey: text('storage_key').notNull(),
    // null = bucket por defecto del entorno (StorageService). Se guarda por si el
    // bucket cambia entre entornos y hay que resolver dónde vive el objeto.
    bucket: text('bucket'),
    fileName: text('file_name'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    checksum: text('checksum'), // ETag / hash opcional para integridad
    url: text('url'), // url pública/externa opcional (no presigned)
    // ── Asociación polimórfica opcional al dominio dueño ──
    ownerType: text('owner_type'), // ej. 'instrument'
    ownerId: uuid('owner_id'), // sin FK: es polimórfico
    purpose: text('purpose'), // ej. 'enunciado_pdf'
    note: text('note'),
    meta: jsonb('meta').$type<Record<string, unknown>>().default({}),
    createdById: uuid('created_by_id').references(() => users.id),
    deletedAt: timestamp('deleted_at'), // soft delete (§5.1)
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    // Lookup por dueño (ej. "los archivos del instrumento X con purpose Y").
    ownerIdx: index('files_owner_idx').on(t.ownerType, t.ownerId, t.purpose),
    // Lookup/confirmación por storage key.
    storageKeyIdx: index('files_storage_key_idx').on(t.storageKey),
    orgIdx: index('files_org_idx').on(t.orgId),
  }),
);

export const filesRelations = relations(files, ({ one }) => ({
  org: one(organizations, { fields: [files.orgId], references: [organizations.id] }),
  createdBy: one(users, { fields: [files.createdById], references: [users.id] }),
}));

// `File` colisiona con el tipo global del DOM → usamos `FileRecord`.
export type FileRecord = typeof files.$inferSelect;
export type NewFileRecord = typeof files.$inferInsert;
