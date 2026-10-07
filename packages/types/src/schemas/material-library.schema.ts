import { z } from 'zod';
import {
  documentListQuerySchema,
  documentSourceSchema,
  type DocumentListItem,
} from './document.schema';
import type { RemedialMaterialType, RemedialStatus } from './remedial.schema';

// ─────────────────────────────────────────────────────────────────────────────
// Biblioteca unificada de Materiales (docs/diseno/rediseno-navegacion.md §5).
//
// GET /documents/library
//
// Lista documentos y material remedial juntos. Un remedial que ya se abrió en el editor
// (existe un documento con source = { kind: 'remedial', refId }) aparece UNA vez, como
// documento, con el estado del remedial adjunto. El remedial sigue siendo su propia
// entidad con su ciclo de aprobación IA → humano.
// ─────────────────────────────────────────────────────────────────────────────

export const MATERIAL_ORIGINS = documentSourceSchema.shape.kind.options;
export const materialOriginSchema = z.enum(MATERIAL_ORIGINS);
export type MaterialOrigin = z.infer<typeof materialOriginSchema>;

// "Por revisar" = remedial generado (`ready`) que todavía no aprueba ni descarta un humano.
export const MATERIAL_REVIEW_FILTERS = ['pending_review'] as const;
export const materialReviewFilterSchema = z.enum(MATERIAL_REVIEW_FILTERS);
export type MaterialReviewFilter = z.infer<typeof materialReviewFilterSchema>;

/**
 * Estados de remedial que la biblioteca lista. `failed` y `discarded` quedan fuera:
 * no hay material utilizable que abrir ni revisar.
 */
export const LIBRARY_REMEDIAL_STATUSES = [
  'pending',
  'processing',
  'ready',
  'approved',
] as const satisfies readonly RemedialStatus[];

/**
 * `type`/`status` son atributos de documento: si vienen, la biblioteca lista sólo
 * documentos. `subjectId`/`gradeId` filtran remediales por el nodo de taxonomía y
 * `mine` por quién los generó. Se conservan los filtros que ya tenía /materiales.
 */
export const materialLibraryQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    origin: materialOriginSchema.optional(),
    review: materialReviewFilterSchema.optional(),
    q: z.string().max(200).optional(),
    type: documentListQuerySchema.shape.type,
    status: documentListQuerySchema.shape.status,
    subjectId: documentListQuerySchema.shape.subjectId,
    gradeId: documentListQuerySchema.shape.gradeId,
    mine: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();
export type MaterialLibraryQueryDto = z.infer<typeof materialLibraryQuerySchema>;

/** Estado del remedial asociado a una fila (documento forkeado o remedial sin abrir). */
export type MaterialRemedialRef = {
  remedialMaterialId: string;
  remedialType: RemedialMaterialType;
  status: RemedialStatus;
};

export type MaterialLibraryDocumentItem = {
  kind: 'document';
  document: DocumentListItem;
  origin: MaterialOrigin;
  /** Presente si el documento nació de un remedial. */
  remedial: MaterialRemedialRef | null;
  updatedAt: string; // ISO
};

export type MaterialLibraryRemedialItem = {
  kind: 'remedial';
  id: string;
  title: string;
  origin: 'remedial';
  remedial: MaterialRemedialRef;
  nodeId: string | null;
  assessmentId: string | null;
  updatedAt: string; // ISO
};

export type MaterialLibraryItem = MaterialLibraryDocumentItem | MaterialLibraryRemedialItem;

export type MaterialLibraryResponse = {
  data: MaterialLibraryItem[];
  total: number;
  page: number;
  limit: number;
};
