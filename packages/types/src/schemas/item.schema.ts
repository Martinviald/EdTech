import { z } from 'zod';
import { ITEM_TYPES, type ItemType } from '../enums';

export const ITEM_STATUS = ['draft', 'review', 'published', 'deprecated'] as const;
export type ItemStatus = (typeof ITEM_STATUS)[number];

export const ITEM_SOURCES = ['official', 'ai_generated', 'custom', 'imported'] as const;
export type ItemSource = (typeof ITEM_SOURCES)[number];

export const ITEM_TAG_TYPES = ['primary', 'secondary'] as const;
export type ItemTagType = (typeof ITEM_TAG_TYPES)[number];

export const TAGGED_BY = ['human', 'ai'] as const;
export type TaggedBy = (typeof TAGGED_BY)[number];

// ── Banco de ítems: alcance (scope) (TKT-14) ─────────────────────────────────
// El banco de ítems es transversal a los instrumentos y combina dos orígenes:
//   · 'own'    → ítems propios de la org del usuario (org_id = orgId).
//   · 'global' → ítems globales/oficiales compartidos (org_id IS NULL).
//   · 'all'    → ambos (comportamiento por defecto histórico).
// El aislamiento NO se apoya en RLS: `items` no es tabla RLS (no contiene PII).
// Los datos sensibles (respuestas/resultados) siguen aislados por RLS vía
// `assessments`. La lectura del banco global sólo expone contenido de ítems.
export const ITEM_BANK_SCOPES = ['own', 'global', 'all'] as const;
export type ItemBankScope = (typeof ITEM_BANK_SCOPES)[number];
export const itemBankScopeSchema = z.enum(ITEM_BANK_SCOPES);

const itemTypeSchema = z.enum(ITEM_TYPES);
const itemStatusSchema = z.enum(ITEM_STATUS);
const itemSourceSchema = z.enum(ITEM_SOURCES);
const itemTagTypeSchema = z.enum(ITEM_TAG_TYPES);
const taggedBySchema = z.enum(TAGGED_BY);

// ── IRT Parameters ───────────────────────────────────────────────────────────

export const irtParamsSchema = z
  .object({
    a: z.number().min(0).optional(),
    b: z.number().optional(),
    c: z.number().min(0).max(1).optional(),
  })
  .optional();

export type IrtParams = z.infer<typeof irtParamsSchema>;

// ── Scoring Config ───────────────────────────────────────────────────────────

export const scoringConfigSchema = z
  .object({
    points: z.number().min(0).optional(),
    partialCredit: z.boolean().optional(),
  })
  .passthrough()
  .optional();

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

// ── Multiple Choice Content ──────────────────────────────────────────────────

export const multipleChoiceContentSchema = z.object({
  stem: z.string().min(1),
  alternatives: z.array(
    z.object({
      key: z.string().min(1).max(5),
      text: z.string().min(1),
      isCorrect: z.boolean(),
    }),
  ).min(2),
  imageUrl: z.string().url().optional(),
  explanation: z.string().optional(),
});

export type MultipleChoiceContent = z.infer<typeof multipleChoiceContentSchema>;

// ── Items ────────────────────────────────────────────────────────────────────

// ── Cross-validación content ↔ type ──────────────────────────────────────────
// `content` debe cumplir el schema Zod del `type` declarado. El registro
// `ITEM_CONTENT_SCHEMAS` vive en item-content.schema.ts, que importa
// `multipleChoiceContentSchema` desde ESTE archivo. Para no crear un ciclo de
// inicialización de módulos (TDZ en `ITEM_CONTENT_SCHEMAS`), resolvemos el
// registro de forma perezosa DENTRO del callback de superRefine (corre en tiempo
// de validación, cuando todos los módulos ya están cargados).
function refineContentByType(
  data: { type?: ItemType; content?: unknown },
  ctx: z.RefinementCtx,
): void {
  // Solo validamos cuando ambos campos están presentes (en update parcial, uno
  // puede faltar). Sin `type` no sabemos contra qué schema cruzar.
  if (data.type === undefined || data.content === undefined) return;

  // Import perezoso para evitar el ciclo item.schema ↔ item-content.schema.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ITEM_CONTENT_SCHEMAS } = require('./item-content.schema') as typeof import('./item-content.schema');
  const schema = ITEM_CONTENT_SCHEMAS[data.type];

  const result = schema.safeParse(data.content);
  if (result.success) return;

  for (const issue of result.error.issues) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['content', ...issue.path],
      message: issue.message,
    });
  }
}

export const createItemSchema = z
  .object({
    instrumentId: z.string().uuid().optional(),
    sectionId: z.string().uuid().optional(),
    position: z.number().int().min(0).default(0),
    type: itemTypeSchema,
    content: z.record(z.unknown()).default({}),
    scoringConfig: scoringConfigSchema,
    irtParams: irtParamsSchema,
    status: itemStatusSchema.default('draft'),
    source: itemSourceSchema.default('custom'),
    tags: z
      .array(
        z.object({
          nodeId: z.string().uuid(),
          tagType: itemTagTypeSchema.default('primary'),
        }),
      )
      .optional(),
  })
  .superRefine(refineContentByType);

export const updateItemSchema = createItemSchema
  .innerType()
  .omit({ tags: true })
  .partial()
  .superRefine(refineContentByType);

/**
 * Coacciona `taxonomyNodeIds` a `string[]` aceptando: array (?taxonomyNodeIds=a&…),
 * valor único (string) o CSV ("a,b,c"). Los uuids se validan tras normalizar.
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
 * grupo. Espejo del schema en apps/api (item.dto.ts).
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

export const listItemsQuerySchema = z.object({
  instrumentId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  type: itemTypeSchema.optional(),
  status: itemStatusSchema.optional(),
  source: itemSourceSchema.optional(),
  // Filtro por un nodo (retrocompatible).
  taxonomyNodeId: z.string().uuid().optional(),
  // Filtro multi-tag con lógica OR (TKT-12/TKT-14): el ítem se incluye si tiene
  // CUALQUIERA de estos nodos etiquetado. Se combina con `taxonomyNodeId` (OR).
  taxonomyNodeIds: taxonomyNodeIdsSchema,
  // Filtro facetado del banco: asignatura Y nivel (transitivo vía tags → nodos).
  subjectId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  // Grupos AND (OR dentro de cada grupo): un grupo por tipo de nodo elegido.
  taxonomyNodeGroups: taxonomyNodeGroupsSchema,
  // Alcance del banco de ítems (TKT-14): 'own' | 'global' | 'all' (default).
  scope: itemBankScopeSchema.default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateItemDto = z.infer<typeof createItemSchema>;
export type UpdateItemDto = z.infer<typeof updateItemSchema>;
export type ListItemsQueryDto = z.infer<typeof listItemsQuerySchema>;

// ── Taxonomy Tags ────────────────────────────────────────────────────────────

export const createItemTagSchema = z.object({
  itemId: z.string().uuid(),
  nodeId: z.string().uuid(),
  tagType: itemTagTypeSchema.default('primary'),
  confidence: z.coerce.number().min(0).max(1).default(1),
  taggedBy: taggedBySchema.default('human'),
});

export const batchTagItemsSchema = z.object({
  tags: z.array(
    z.object({
      itemId: z.string().uuid(),
      nodeId: z.string().uuid(),
      tagType: itemTagTypeSchema.default('primary'),
      confidence: z.coerce.number().min(0).max(1).default(1),
      taggedBy: taggedBySchema.default('human'),
    }),
  ).min(1),
});

export type CreateItemTagDto = z.infer<typeof createItemTagSchema>;
export type BatchTagItemsDto = z.infer<typeof batchTagItemsSchema>;

// ── Item Versions ────────────────────────────────────────────────────────────

export const createItemVersionSchema = z.object({
  content: z.record(z.unknown()),
  irtParams: z.record(z.unknown()).optional(),
  changeNote: z.string().max(500).optional(),
});

export type CreateItemVersionDto = z.infer<typeof createItemVersionSchema>;

// ── AI Tagging ───────────────────────────────────────────────────────────────

export const aiTagSuggestionSchema = z.object({
  nodeId: z.string().uuid(),
  nodeName: z.string(),
  nodeType: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
});

export const aiTagRequestSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(50),
  taxonomyId: z.string().uuid(),
});

export const confirmAiTagsSchema = z.object({
  tags: z.array(
    z.object({
      itemId: z.string().uuid(),
      nodeId: z.string().uuid(),
      tagType: itemTagTypeSchema.default('primary'),
      confirmed: z.boolean(),
    }),
  ).min(1),
});

export type AiTagSuggestion = z.infer<typeof aiTagSuggestionSchema>;
export type AiTagRequestDto = z.infer<typeof aiTagRequestSchema>;
export type ConfirmAiTagsDto = z.infer<typeof confirmAiTagsSchema>;

// ── DIA Ingestion ────────────────────────────────────────────────────────────

export const diaIngestionRequestSchema = z.object({
  taxonomyId: z.string().uuid(),
  subjectId: z.string().uuid(),
  gradeId: z.string().uuid(),
  year: z.number().int().min(2020).max(2100),
  version: z.string().max(50).optional(),
  name: z.string().min(2).max(300),
});

export type DiaIngestionRequestDto = z.infer<typeof diaIngestionRequestSchema>;

// ── DIA Ingestion Response Models ────────────────────────────────────────────

export type DiaItemPreview = {
  position: number;
  type: string;
  correctKey: string | null;
  skill: string | null;
  oa: string | null;
  content: Record<string, unknown>;
};

export type DiaPreviewResponse = {
  items: DiaItemPreview[];
  warnings: string[];
};

export type DiaConfirmResponse = {
  instrumentId: string;
  itemsCreated: number;
};

// ── Spec Table Import ────────────────────────────────────────────────────────

export const specTableMappingSchema = z.object({
  instrumentId: z.string().uuid(),
  taxonomyId: z.string().uuid(),
  fileData: z.array(z.record(z.string())).min(1),
  columnMapping: z.record(z.string()),
});

export type SpecTableMappingDto = z.infer<typeof specTableMappingSchema>;

export type SpecTableUploadResponse = {
  columns: string[];
  preview: SpecTableRow[];
  // Todas las filas parseadas — se reenvían al backend en el paso de vinculación.
  // `preview` es solo un subconjunto para mostrar.
  fileData: Record<string, string>[];
  totalRows: number;
};

export type SpecTableRow = {
  position?: number;
  skill?: string;
  oa?: string;
  content?: string;
  [key: string]: unknown;
};

export type SpecTableLinkedItem = {
  position: number;
  nodes: Array<{ type: string; name: string; code: string | null }>;
};

export type SpecTableUnlinkedItem = {
  position: number | null;
  reason: string;
};

export type SpecTableLinkResponse = {
  linked: number;
  warnings: string[];
  errors: string[];
  linkedItems: SpecTableLinkedItem[];
  unlinkedItems: SpecTableUnlinkedItem[];
};

// ── Response Models (API shape) ──────────────────────────────────────────────

export type ItemTaxonomyTagModel = {
  id: string;
  itemId: string;
  nodeId: string;
  tagType: ItemTagType;
  confidence: string;
  taggedBy: TaggedBy;
  taggedAt: string | Date;
  node?: {
    id: string;
    name: string;
    type: string;
    code: string | null;
    description: string | null;
    taxonomyId: string;
  };
};

export type ItemModel = {
  id: string;
  orgId: string | null;
  instrumentId: string | null;
  sectionId: string | null;
  position: number;
  type: ItemType;
  content: Record<string, unknown>;
  scoringConfig: Record<string, unknown> | null;
  irtParams: Record<string, unknown> | null;
  status: ItemStatus;
  version: number;
  source: ItemSource;
  createdById: string | null;
  deletedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  tags?: ItemTaxonomyTagModel[];
};

export type ItemVersionModel = {
  id: string;
  itemId: string;
  version: number;
  content: Record<string, unknown>;
  irtParams: Record<string, unknown> | null;
  changedById: string | null;
  changeNote: string | null;
  createdAt: string | Date;
};

/**
 * Figura (imagen) asociada a un ítem: la banda recortada del PDF original que
 * contiene el enunciado gráfico y/o las alternativas-imagen. Vive en el módulo
 * genérico `files` (`owner_type='item'`, `purpose='item_figure'`); la storage key
 * queda además en `items.scoring_config.imageRef`.
 *
 * Calcado de `InstrumentAttachmentModel`: las URLs prefirmadas son opcionales
 * porque solo se emiten cuando el almacenamiento S3 está configurado.
 */
export type ItemFigureModel = {
  id: string;
  itemId: string;
  storageKey: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  /** URL prefirmada de descarga (fuerza descarga). */
  downloadUrl?: string;
  /** URL prefirmada de previsualización (Content-Disposition: inline). */
  previewUrl?: string;
};
