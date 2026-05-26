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

export const createItemSchema = z.object({
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
});

export const updateItemSchema = createItemSchema.omit({ tags: true }).partial();

export const listItemsQuerySchema = z.object({
  instrumentId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  type: itemTypeSchema.optional(),
  status: itemStatusSchema.optional(),
  source: itemSourceSchema.optional(),
  taxonomyNodeId: z.string().uuid().optional(),
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
  curriculumId: z.string().uuid(),
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
  curriculumId: z.string().uuid(),
  subjectId: z.string().uuid(),
  gradeId: z.string().uuid(),
  year: z.number().int().min(2020).max(2100),
  version: z.string().max(50).optional(),
  name: z.string().min(2).max(300),
});

export type DiaIngestionRequestDto = z.infer<typeof diaIngestionRequestSchema>;

// ── Spec Table Import ────────────────────────────────────────────────────────

export const specTableMappingSchema = z.object({
  instrumentId: z.string().uuid(),
  columnMapping: z.record(z.string()),
});

export type SpecTableMappingDto = z.infer<typeof specTableMappingSchema>;

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
