import { z } from 'zod';
import { paginationSchema } from '@soe/types';

// ── Item Type / Status / Source enums ───────────────────────────────────────
const ITEM_TYPES = [
  'multiple_choice',
  'true_false',
  'open_ended',
  'oral_reading',
  'oral_expression',
  'writing',
  'listening',
  'matching',
  'ordering',
  'gap_fill',
] as const;

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

export const listItemsQuerySchema = paginationSchema.extend({
  instrumentId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  type: z.enum(ITEM_TYPES).optional(),
  status: z.enum(ITEM_STATUSES).optional(),
  source: z.enum(ITEM_SOURCES).optional(),
  taxonomyNodeId: z.string().uuid().optional(),
});

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
