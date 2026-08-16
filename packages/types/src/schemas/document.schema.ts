import { z } from 'zod';
import { ITEM_TYPES } from '../enums';
import { orgBrandingSchema } from './organization.schema';

// ─────────────────────────────────────────────────────────────────────────────
// Editor de Materiales — Motor de documentos por bloques (docs/propuesta-editor-materiales.md).
// Contratos compartidos del módulo `documents` (apps/api/src/documents/, ruta base
// /api/documents) y la UI /materiales.
//
// Principio rector (§6 de la propuesta): `documents` es la capa de AUTORÍA /
// presentación. NO duplica el stack de medición: los bloques `item` referencian
// filas vivas de `items` (itemId autoritativo) y la medición pasa por la cadena
// instruments → assessments → results vía promoción opt-in (Decisión G2).
//
// El contenido es un envelope VERSIONADO `{ version, blocks }` con unión
// discriminada por `type` de bloque (Open/Closed: un tipo de bloque nuevo es un
// miembro más de la unión + su renderer en el BlockRegistry, nunca una migración).
// ─────────────────────────────────────────────────────────────────────────────

export const DOCUMENT_TYPES = ['guide', 'worksheet', 'assessment', 'generic'] as const;
export const documentTypeSchema = z.enum(DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const documentStatusSchema = z.enum(['draft', 'published', 'archived']);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

/**
 * Escalera de compartición (Decisión B). v1 implementa `private` y `org` (default
 * `org`: compartido dentro del colegio); `department`, `network` y `platform`
 * existen en el enum desde el día 1 para poder restringir/expandir sin migración.
 * Usar una plantilla compartida NO edita el original: crea una copia propia
 * (copy-on-use, POST /documents/:id/duplicate).
 */
export const documentVisibilitySchema = z.enum([
  'private',
  'department',
  'org',
  'network',
  'platform',
]);
export type DocumentVisibility = z.infer<typeof documentVisibilitySchema>;

// ── Bloques ──────────────────────────────────────────────────────────────────

const blockBaseSchema = z.object({
  /** Identidad estable del bloque (uuid generado en cliente al insertar). */
  id: z.string().uuid(),
});

export const headingBlockSchema = blockBaseSchema.extend({
  type: z.literal('heading'),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  text: z.string().max(300),
});
export type HeadingBlock = z.infer<typeof headingBlockSchema>;

/**
 * Texto rico como MARKDOWN (Decisión D). Se renderiza con el `react-markdown`
 * seguro existente (sin rehype-raw). Un futuro editor visual reemplaza solo el
 * EditView de este bloque y sigue serializando a markdown (o bumpea `version`).
 */
export const textBlockSchema = blockBaseSchema.extend({
  type: z.literal('text'),
  markdown: z.string().max(20000),
});
export type TextBlock = z.infer<typeof textBlockSchema>;

export const listBlockSchema = blockBaseSchema.extend({
  type: z.literal('list'),
  style: z.enum(['bullet', 'number']),
  items: z.array(z.string().max(2000)),
});
export type ListBlock = z.infer<typeof listBlockSchema>;

export const calloutBlockSchema = blockBaseSchema.extend({
  type: z.literal('callout'),
  tone: z.enum(['info', 'tip', 'warning']),
  title: z.string().max(200).optional(),
  markdown: z.string().max(10000),
});
export type CalloutBlock = z.infer<typeof calloutBlockSchema>;

/**
 * Snapshot de render de un ítem referenciado (caché refrescable, NO fuente de
 * verdad — esa es la fila viva en `items`, apuntada por `itemId`). Hace el
 * documento autocontenido para imprimir aunque el ítem cambie después; la acción
 * "actualizar desde el banco" lo refresca. `content` conserva la forma polimórfica
 * de `ItemContent` (ya validada por tipo en la capa de ítems).
 */
export const documentItemSnapshotSchema = z.object({
  type: z.enum(ITEM_TYPES),
  version: z.number().int(),
  content: z.record(z.unknown()),
});
export type DocumentItemSnapshot = z.infer<typeof documentItemSnapshotSchema>;

/**
 * El puente medible: referencia una fila viva de `items` (cadena
 * instrument → assessment → results). `showAnswer` gobierna la versión
 * profesor (con pauta) vs alumno del render/impresión.
 */
export const itemBlockSchema = blockBaseSchema.extend({
  type: z.literal('item'),
  itemId: z.string().uuid(),
  showAnswer: z.boolean(),
  snapshot: documentItemSnapshotSchema,
});
export type ItemBlock = z.infer<typeof itemBlockSchema>;

/** Imagen subida vía el módulo `files` (presigned S3). */
export const imageBlockSchema = blockBaseSchema.extend({
  type: z.literal('image'),
  fileId: z.string().uuid(),
  caption: z.string().max(300).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
});
export type ImageBlock = z.infer<typeof imageBlockSchema>;

export const dividerBlockSchema = blockBaseSchema.extend({
  type: z.literal('divider'),
});
export type DividerBlock = z.infer<typeof dividerBlockSchema>;

/** Espacio vertical explícito (útil para dejar espacio de respuesta al imprimir). */
export const spacerBlockSchema = blockBaseSchema.extend({
  type: z.literal('spacer'),
  size: z.enum(['sm', 'md', 'lg']),
});
export type SpacerBlock = z.infer<typeof spacerBlockSchema>;

/** Actividad de clase (para guías; espeja classActivities del remedial). */
export const activityBlockSchema = blockBaseSchema.extend({
  type: z.literal('activity'),
  title: z.string().max(300),
  description: z.string().max(10000),
  durationMin: z.number().int().nullable(),
});
export type ActivityBlock = z.infer<typeof activityBlockSchema>;

export const blockSchema = z.discriminatedUnion('type', [
  headingBlockSchema,
  textBlockSchema,
  listBlockSchema,
  calloutBlockSchema,
  itemBlockSchema,
  imageBlockSchema,
  dividerBlockSchema,
  spacerBlockSchema,
  activityBlockSchema,
]);
export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block['type'];

export const DOCUMENT_CONTENT_VERSION = 1;

/**
 * Envelope versionado del contenido. `version` habilita migrar la forma de los
 * bloques hacia adelante (o a un `document_blocks` normalizado) sin reescribir
 * el módulo — es el seguro de los cimientos (Decisión A).
 */
export const documentContentSchema = z.object({
  version: z.literal(DOCUMENT_CONTENT_VERSION),
  blocks: z.array(blockSchema).max(500),
});
export type DocumentContent = z.infer<typeof documentContentSchema>;

// ── Trazabilidad de origen (fork unidireccional, Decisión C) ────────────────

export const documentSourceSchema = z.object({
  kind: z.enum(['blank', 'remedial', 'instrument', 'document']),
  /** id del material remedial / instrumento / documento del que se forkeó. */
  refId: z.string().uuid().nullable(),
});
export type DocumentSource = z.infer<typeof documentSourceSchema>;

/**
 * Snapshot del branding de la org al momento de publicar/exportar (estabilidad:
 * el documento impreso no cambia si la org cambia su logo después). El render
 * por defecto usa el branding VIVO de la org; este campo congela.
 */
export const documentBrandingSnapshotSchema = orgBrandingSchema.extend({
  capturedAt: z.string(),
});
export type DocumentBrandingSnapshot = z.infer<typeof documentBrandingSnapshotSchema>;

// ── Modelos de respuesta ─────────────────────────────────────────────────────

export const documentModelSchema = z.object({
  id: z.string().uuid(),
  /** null = material de plataforma (plantillas cross-colegio, Decisión B). */
  orgId: z.string().uuid().nullable(),
  createdById: z.string().uuid().nullable(),
  createdByName: z.string().nullable(),
  title: z.string(),
  type: documentTypeSchema,
  status: documentStatusSchema,
  visibility: documentVisibilitySchema,
  subjectId: z.string().uuid().nullable(),
  gradeId: z.string().uuid().nullable(),
  nodeId: z.string().uuid().nullable(),
  /** Binding de medición (Decisión G2): set solo tras promote-to-instrument. */
  instrumentId: z.string().uuid().nullable(),
  content: documentContentSchema,
  source: documentSourceSchema,
  branding: documentBrandingSnapshotSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DocumentModel = z.infer<typeof documentModelSchema>;

/** Fila de la biblioteca (/materiales): sin `content` para no arrastrar el JSONB en listas. */
export const documentListItemSchema = documentModelSchema
  .omit({ content: true, branding: true })
  .extend({
    blockCount: z.number().int(),
    itemCount: z.number().int(),
  });
export type DocumentListItem = z.infer<typeof documentListItemSchema>;

export const documentListResponseSchema = z.object({
  data: z.array(documentListItemSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export type DocumentListResponse = z.infer<typeof documentListResponseSchema>;

// ── DTOs de entrada ──────────────────────────────────────────────────────────

export const createDocumentSchema = z.object({
  title: z.string().min(1).max(300),
  type: documentTypeSchema,
  content: documentContentSchema.optional(),
  visibility: documentVisibilitySchema.optional(),
  subjectId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  nodeId: z.string().uuid().optional(),
});
export type CreateDocumentDto = z.infer<typeof createDocumentSchema>;

export const updateDocumentSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  content: documentContentSchema.optional(),
  status: documentStatusSchema.optional(),
  visibility: documentVisibilitySchema.optional(),
  subjectId: z.string().uuid().nullable().optional(),
  gradeId: z.string().uuid().nullable().optional(),
  nodeId: z.string().uuid().nullable().optional(),
});
export type UpdateDocumentDto = z.infer<typeof updateDocumentSchema>;

export const documentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: documentTypeSchema.optional(),
  status: documentStatusSchema.optional(),
  visibility: documentVisibilitySchema.optional(),
  subjectId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  /** `mine=true` filtra a los documentos creados por el usuario autenticado. */
  mine: z.coerce.boolean().optional(),
  q: z.string().max(200).optional(),
});
export type DocumentListQueryDto = z.infer<typeof documentListQuerySchema>;
