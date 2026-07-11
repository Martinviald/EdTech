import { z } from 'zod';
import { TAXONOMY_NODE_TYPES, type TaxonomyNodeType } from '../enums';

// Tipos de marco académico (taxonomía). Réplica local de taxonomyTypeEnum en
// packages/db/src/schema/enums.ts.
export const TAXONOMY_TYPES = [
  'mineduc',
  'simce',
  'paes',
  'dia',
  'cambridge',
  'aptus',
  'desafio',
  'custom',
] as const;
export type TaxonomyType = (typeof TAXONOMY_TYPES)[number];

export const taxonomyTypeSchema = z.enum(TAXONOMY_TYPES);
export const taxonomyNodeTypeSchema = z.enum(TAXONOMY_NODE_TYPES);

export const createTaxonomySchema = z.object({
  name: z.string().min(2).max(200),
  type: taxonomyTypeSchema,
  language: z.string().min(2).max(10).default('es'),
  version: z.string().max(50).optional(),
  isOfficial: z.boolean().default(false),
  metadata: z.record(z.unknown()).optional(),
});

export const updateTaxonomySchema = createTaxonomySchema.partial();

export const listTaxonomiesQuerySchema = z.object({
  type: taxonomyTypeSchema.optional(),
  isOfficial: z.coerce.boolean().optional(),
});

export const createTaxonomyNodeSchema = z.object({
  taxonomyId: z.string().uuid(),
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
  .omit({ taxonomyId: true })
  .partial();

export const listTaxonomyNodesQuerySchema = z.object({
  taxonomyId: z.string().uuid(),
  gradeId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  type: taxonomyNodeTypeSchema.optional(),
  parentId: z.string().uuid().optional(),
});

// Opciones de nodos para los dropdowns del banco de ítems: lista nodos de las
// taxonomías visibles (oficiales + de la org), acotados por asignatura/nivel/tipo,
// sin exigir `taxonomyId` (cross-currículo). Poblada los filtros en cascada.
export const listTaxonomyNodeFacetsQuerySchema = z.object({
  subjectId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  type: taxonomyNodeTypeSchema.optional(),
  // Restringe a un marco (tipo de taxonomía). Ej.: `mineduc` = Currículum
  // Nacional. Permite que el banco filtre por un marco a la vez.
  taxonomyType: taxonomyTypeSchema.optional(),
});

export type CreateTaxonomyDto = z.infer<typeof createTaxonomySchema>;
export type UpdateTaxonomyDto = z.infer<typeof updateTaxonomySchema>;
export type ListTaxonomiesQueryDto = z.infer<typeof listTaxonomiesQuerySchema>;
export type CreateTaxonomyNodeDto = z.infer<typeof createTaxonomyNodeSchema>;
export type UpdateTaxonomyNodeDto = z.infer<typeof updateTaxonomyNodeSchema>;
export type ListTaxonomyNodesQueryDto = z.infer<typeof listTaxonomyNodesQuerySchema>;
export type ListTaxonomyNodeFacetsQueryDto = z.infer<typeof listTaxonomyNodeFacetsQuerySchema>;

// ── Modelos (response shape de la API) ────────────────────────────────────────
// El refactor "web-no-db-direct" impide importar tipos de Drizzle desde @soe/web.
// Reflejamos aquí el shape devuelto por la API NestJS (que sí lee Drizzle).

export type TaxonomyModel = {
  id: string;
  name: string;
  type: TaxonomyType;
  language: string;
  version: string | null;
  isOfficial: boolean;
  orgId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string | Date;
};

export type TaxonomyNodeModel = {
  id: string;
  taxonomyId: string;
  parentId: string | null;
  type: TaxonomyNodeType;
  code: string | null;
  name: string;
  description: string | null;
  gradeId: string | null;
  subjectId: string | null;
  order: number;
  depth: number;
  metadata: Record<string, unknown> | null;
  createdAt: string | Date;
};

export type TaxonomyTreeNodeModel = TaxonomyNodeModel & {
  children: TaxonomyTreeNodeModel[];
};

export type TaxonomyTreeResponse = {
  taxonomy: TaxonomyModel;
  nodes: TaxonomyNodeModel[];
  tree: TaxonomyTreeNodeModel[];
};
