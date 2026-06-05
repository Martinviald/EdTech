import {
  boolean,
  decimal,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { taxonomyTypeEnum, taxonomyMappingTypeEnum, taxonomyNodeTypeEnum } from './enums';
import { organizations } from './organizations';
import { grades, subjects } from './academic';

export const taxonomies = pgTable(
  'taxonomies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    type: taxonomyTypeEnum('type').notNull(),
    language: text('language').default('es').notNull(),
    version: text('version'),
    isOfficial: boolean('is_official').default(false).notNull(),
    orgId: uuid('org_id').references(() => organizations.id),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Un (type, version) oficial debe ser único globalmente. Sin esto, el seed
    // o la API podrían crear MINEDUC 2024 N veces. Partial index para no
    // restringir los custom (que deben coexistir por org).
    uniqueIndex('taxonomies_official_type_version_uniq')
      .on(table.type, table.version)
      .where(sql`${table.isOfficial} = true AND ${table.orgId} IS NULL`),
  ],
);

export const taxonomyNodes = pgTable(
  'taxonomy_nodes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taxonomyId: uuid('taxonomy_id')
      .notNull()
      .references(() => taxonomies.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    type: taxonomyNodeTypeEnum('type').notNull(),
    code: text('code'),
    name: text('name').notNull(),
    description: text('description'),
    gradeId: uuid('grade_id').references(() => grades.id),
    subjectId: uuid('subject_id').references(() => subjects.id),
    order: integer('order').default(0).notNull(),
    depth: integer('depth').default(0).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('taxonomy_nodes_taxonomy_code_uniq')
      .on(table.taxonomyId, table.code)
      .where(sql`${table.code} IS NOT NULL`),
  ],
);

export const taxonomyMappings = pgTable(
  'taxonomy_mappings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceNodeId: uuid('source_node_id')
      .notNull()
      .references(() => taxonomyNodes.id, { onDelete: 'cascade' }),
    targetNodeId: uuid('target_node_id')
      .notNull()
      .references(() => taxonomyNodes.id, { onDelete: 'cascade' }),
    mappingType: taxonomyMappingTypeEnum('mapping_type').notNull(),
    confidence: decimal('confidence', { precision: 3, scale: 2 }).default('1.00'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.sourceNodeId, table.targetNodeId)],
);

export const taxonomiesRelations = relations(taxonomies, ({ many }) => ({
  nodes: many(taxonomyNodes),
}));

export const taxonomyNodesRelations = relations(taxonomyNodes, ({ one, many }) => ({
  taxonomy: one(taxonomies, {
    fields: [taxonomyNodes.taxonomyId],
    references: [taxonomies.id],
  }),
  parent: one(taxonomyNodes, {
    fields: [taxonomyNodes.parentId],
    references: [taxonomyNodes.id],
    relationName: 'taxonomy_parent',
  }),
  children: many(taxonomyNodes, { relationName: 'taxonomy_parent' }),
  grade: one(grades, { fields: [taxonomyNodes.gradeId], references: [grades.id] }),
  subject: one(subjects, { fields: [taxonomyNodes.subjectId], references: [subjects.id] }),
}));

export type Taxonomy = typeof taxonomies.$inferSelect;
export type NewTaxonomy = typeof taxonomies.$inferInsert;
export type TaxonomyNode = typeof taxonomyNodes.$inferSelect;
export type NewTaxonomyNode = typeof taxonomyNodes.$inferInsert;
export type TaxonomyMapping = typeof taxonomyMappings.$inferSelect;
export type NewTaxonomyMapping = typeof taxonomyMappings.$inferInsert;
