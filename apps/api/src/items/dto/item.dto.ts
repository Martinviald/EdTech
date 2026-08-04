import { z } from 'zod';
import {
  ITEM_DIFFICULTIES,
  ITEM_TYPES,
  csvArraySchema,
  itemBankScopeSchema,
  paginationSchema,
  uuidCsvSchema,
} from '@soe/types';

// ── Item Status / Source enums ──────────────────────────────────────────────
const ITEM_STATUSES = ['draft', 'review', 'published', 'deprecated'] as const;

const ITEM_SOURCES = ['official', 'ai_generated', 'custom', 'imported'] as const;

const ITEM_TAG_TYPES = ['primary', 'secondary'] as const;
const TAGGED_BY = ['human', 'ai'] as const;

// ── Tag DTOs ────────────────────────────────────────────────────────────────
export const createTagSchema = z.object({
  nodeId: z.string().uuid(),
  tagType: z.enum(ITEM_TAG_TYPES).default('primary'),
  confidence: z.string().default('1.00'),
  taggedBy: z.enum(TAGGED_BY).default('human'),
});

export const batchTagSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(200),
  nodeId: z.string().uuid(),
  tagType: z.enum(ITEM_TAG_TYPES).default('primary'),
  confidence: z.string().default('1.00'),
  taggedBy: z.enum(TAGGED_BY).default('human'),
});

// ── Item DTOs ───────────────────────────────────────────────────────────────
export const createItemSchema = z.object({
  instrumentId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  position: z.number().int().min(0).default(0),
  type: z.enum(ITEM_TYPES),
  content: z.record(z.unknown()).default({}),
  scoringConfig: z
    .object({
      points: z.number().optional(),
      partialCredit: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
  irtParams: z
    .object({
      a: z.number().optional(),
      b: z.number().optional(),
      c: z.number().optional(),
    })
    .optional(),
  status: z.enum(ITEM_STATUSES).default('draft'),
  source: z.enum(ITEM_SOURCES).default('custom'),
  tags: z.array(createTagSchema).optional(),
});

export const updateItemSchema = createItemSchema.omit({ tags: true }).partial();

/**
 * Coacciona `taxonomyNodeIds` a `string[]` desde: array (query repetido),
 * valor único, o CSV. Habilita el filtro multi-tag OR del banco (TKT-12/TKT-14).
 */
const taxonomyNodeIdsSchema = z
  .union([z.array(z.string()), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const arr = Array.isArray(v) ? v : v.split(',');
    return arr.map((s) => s.trim()).filter((s) => s.length > 0);
  })
  .pipe(z.array(z.string().uuid()).optional());

/**
 * Coacciona `taxonomyNodeGroups` a `string[][]` (grupos AND, OR dentro de cada
 * grupo). Cada ocurrencia del query param (repetido) es una CSV de uuids = un
 * grupo. Habilita el filtro facetado por dimensión del banco (asignatura Y nivel
 * Y OA Y habilidad…); varios nodos del mismo grupo = OR entre ellos.
 */
const taxonomyNodeGroupsSchema = z
  .union([z.array(z.string()), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const raw = Array.isArray(v) ? v : [v];
    const groups = raw
      .map((g) =>
        g
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      )
      .filter((g) => g.length > 0);
    return groups.length > 0 ? groups : undefined;
  })
  .pipe(z.array(z.array(z.string().uuid())).optional());

/**
 * Tope de página del banco de ítems. Un instrumento DIA completo ronda los 45
 * ítems, así que 200 deja margen — pero el consumidor NO debe asumir que con
 * pedir el máximo se lleva todo: la respuesta trae `total` y hay que compararlo
 * con `data.length` (la UI del instrumento avisa si se truncó).
 */
const MAX_PAGE_SIZE = 200;

export const listItemsQuerySchema = paginationSchema
  .extend({
    /**
     * Tamaño de página. `limit` es un ALIAS aceptado por compatibilidad: el
     * frontend del detalle de instrumento pide `?limit=200` y, antes de esto,
     * ese parámetro se descartaba en silencio y la lista se cortaba en 20 —
     * mostrando 20 de 33 ítems sin ningún aviso.
     */
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
    instrumentId: z.string().uuid().optional(),
    sectionId: z.string().uuid().optional(),
    type: z.enum(ITEM_TYPES).optional(),
    status: z.enum(ITEM_STATUSES).optional(),
    source: z.enum(ITEM_SOURCES).optional(),
    // Dificultad (T2-21): multi-select CSV.
    difficulty: csvArraySchema(z.enum(ITEM_DIFFICULTIES)),
    // Filtro por un nodo (retrocompatible).
    taxonomyNodeId: z.string().uuid().optional(),
    // Filtro multi-tag con lógica OR (TKT-12/TKT-14).
    taxonomyNodeIds: taxonomyNodeIdsSchema,
    // Filtro facetado del banco: el ítem debe estar etiquetado con un nodo de la
    // asignatura (transitivo vía item_taxonomy_tags → taxonomy_nodes.subject_id).
    subjectId: uuidCsvSchema,
    // Ídem por nivel (taxonomy_nodes.grade_id). Multi-valor (CSV) — T2-13.
    gradeId: uuidCsvSchema,
    // Grupos AND (OR dentro de cada grupo): un grupo por tipo de nodo elegido.
    taxonomyNodeGroups: taxonomyNodeGroupsSchema,
    // Alcance del banco de ítems (TKT-14): 'own' | 'global' | 'all' (default).
    scope: itemBankScopeSchema.default('all'),
  })
  // Canonicaliza a `pageSize`: el resto del service lee sólo ese campo.
  .transform(({ limit, ...query }) => ({ ...query, pageSize: limit ?? query.pageSize }));

// ── Version DTOs ────────────────────────────────────────────────────────────
export const createVersionSchema = z.object({
  changeNote: z.string().max(500).optional(),
});

// ── Inferred types ──────────────────────────────────────────────────────────
export type CreateItemDto = z.infer<typeof createItemSchema>;
export type UpdateItemDto = z.infer<typeof updateItemSchema>;
export type ListItemsQueryDto = z.infer<typeof listItemsQuerySchema>;
export type CreateTagDto = z.infer<typeof createTagSchema>;
export type BatchTagDto = z.infer<typeof batchTagSchema>;
export type CreateVersionDto = z.infer<typeof createVersionSchema>;
