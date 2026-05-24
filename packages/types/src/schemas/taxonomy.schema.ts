import { z } from 'zod';
import { TAXONOMY_NODE_TYPES } from '../enums';

// Replicado localmente desde packages/db/src/schema/enums.ts (curriculumTypeEnum).
// TODO: unificar con CURRICULUM_TYPES en packages/types/src/enums.ts cuando H17.2 mergee
// (H17.2 crea curriculum.schema.ts y probablemente moverá esta lista a enums.ts).
export const CURRICULUM_TYPES_LOCAL = [
  'mineduc',
  'simce',
  'paes',
  'dia',
  'cambridge',
  'aptus',
  'desafio',
  'custom',
] as const;
export type CurriculumType = (typeof CURRICULUM_TYPES_LOCAL)[number];

export const curriculumTypeSchema = z.enum(CURRICULUM_TYPES_LOCAL);
export const taxonomyNodeTypeSchema = z.enum(TAXONOMY_NODE_TYPES);

export const createCurriculumSchema = z.object({
  name: z.string().min(2).max(200),
  type: curriculumTypeSchema,
  language: z.string().min(2).max(10).default('es'),
  version: z.string().max(50).optional(),
  isOfficial: z.boolean().default(false),
  metadata: z.record(z.unknown()).optional(),
});

export const updateCurriculumSchema = createCurriculumSchema.partial();

export const listCurriculaQuerySchema = z.object({
  type: curriculumTypeSchema.optional(),
  isOfficial: z.coerce.boolean().optional(),
});

export const createTaxonomyNodeSchema = z.object({
  curriculumId: z.string().uuid(),
  parentId: z.string().uuid().nullish(),
  type: taxonomyNodeTypeSchema,
  code: z.string().max(50).optional(),
  name: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  gradeId: z.string().uuid().nullish(),
  subjectId: z.string().uuid().nullish(),
  order: z.number().int().min(0).default(0),
  metadata: z.record(z.unknown()).optional(),
});

export const updateTaxonomyNodeSchema = createTaxonomyNodeSchema
  .omit({ curriculumId: true })
  .partial();

export const listTaxonomyNodesQuerySchema = z.object({
  curriculumId: z.string().uuid(),
  gradeId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  type: taxonomyNodeTypeSchema.optional(),
  parentId: z.string().uuid().optional(),
});

export type CreateCurriculumDto = z.infer<typeof createCurriculumSchema>;
export type UpdateCurriculumDto = z.infer<typeof updateCurriculumSchema>;
export type ListCurriculaQueryDto = z.infer<typeof listCurriculaQuerySchema>;
export type CreateTaxonomyNodeDto = z.infer<typeof createTaxonomyNodeSchema>;
export type UpdateTaxonomyNodeDto = z.infer<typeof updateTaxonomyNodeSchema>;
export type ListTaxonomyNodesQueryDto = z.infer<typeof listTaxonomyNodesQuerySchema>;
