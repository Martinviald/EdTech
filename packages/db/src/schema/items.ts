import {
  boolean,
  decimal,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type { ItemContent } from '@soe/types';
import {
  itemSourceEnum,
  itemStatusEnum,
  itemTagTypeEnum,
  itemTypeEnum,
  rubricTypeEnum,
  taggedByEnum,
} from './enums';
import { organizations } from './organizations';
import { subjects } from './academic';
import { taxonomyNodes } from './taxonomy';
import { instruments, instrumentSections } from './instruments';
import { users } from './users';

export const items = pgTable('items', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id),
  instrumentId: uuid('instrument_id').references(() => instruments.id),
  sectionId: uuid('section_id').references(() => instrumentSections.id),
  position: integer('position').default(0).notNull(),
  type: itemTypeEnum('type').notNull(),
  // Contenido polimórfico por `type`: cada valor de `item_type` tiene su shape Zod
  // en `ITEM_CONTENT_SCHEMAS` (@soe/types). La validación ocurre en la capa de
  // aplicación (items.service) con `validateItemContent`; aquí solo tipamos (CLAUDE.md §5.4).
  content: jsonb('content').$type<ItemContent>().notNull().default({} as ItemContent),
  scoringConfig: jsonb('scoring_config')
    .$type<{
      points?: number;
      partialCredit?: boolean;
      [k: string]: unknown;
    }>()
    .default({}),
  irtParams: jsonb('irt_params')
    .$type<{
      a?: number;
      b?: number;
      c?: number;
    }>()
    .default({}),
  status: itemStatusEnum('status').default('draft').notNull(),
  version: integer('version').default(1).notNull(),
  source: itemSourceEnum('source').default('custom').notNull(),
  createdById: uuid('created_by_id').references(() => users.id),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const itemTaxonomyTags = pgTable(
  'item_taxonomy_tags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => taxonomyNodes.id, { onDelete: 'cascade' }),
    tagType: itemTagTypeEnum('tag_type').default('primary').notNull(),
    confidence: decimal('confidence', { precision: 3, scale: 2 }).default('1.00'),
    taggedBy: taggedByEnum('tagged_by').default('human').notNull(),
    taggedAt: timestamp('tagged_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.itemId, table.nodeId)],
);

export const itemVersions = pgTable(
  'item_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    irtParams: jsonb('irt_params').$type<Record<string, unknown>>(),
    changedById: uuid('changed_by_id').references(() => users.id),
    changeNote: text('change_note'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.itemId, table.version)],
);

export const rubrics = pgTable('rubrics', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id),
  name: text('name').notNull(),
  type: rubricTypeEnum('type').default('analytic').notNull(),
  subjectId: uuid('subject_id').references(() => subjects.id),
  createdById: uuid('created_by_id').references(() => users.id),
  isShared: boolean('is_shared').default(false).notNull(),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const rubricCriteria = pgTable('rubric_criteria', {
  id: uuid('id').defaultRandom().primaryKey(),
  rubricId: uuid('rubric_id')
    .notNull()
    .references(() => rubrics.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  maxPoints: decimal('max_points', { precision: 5, scale: 2 }).notNull(),
  order: integer('order').default(0).notNull(),
  taxonomyNodeId: uuid('taxonomy_node_id').references(() => taxonomyNodes.id),
});

export const rubricLevels = pgTable(
  'rubric_levels',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    criterionId: uuid('criterion_id')
      .notNull()
      .references(() => rubricCriteria.id, { onDelete: 'cascade' }),
    score: decimal('score', { precision: 5, scale: 2 }).notNull(),
    descriptor: text('descriptor').notNull(),
    examples: text('examples').array(),
  },
  (table) => [unique().on(table.criterionId, table.score)],
);

export const itemsRelations = relations(items, ({ one, many }) => ({
  org: one(organizations, { fields: [items.orgId], references: [organizations.id] }),
  instrument: one(instruments, { fields: [items.instrumentId], references: [instruments.id] }),
  section: one(instrumentSections, {
    fields: [items.sectionId],
    references: [instrumentSections.id],
  }),
  tags: many(itemTaxonomyTags),
  versions: many(itemVersions),
}));

export const itemVersionsRelations = relations(itemVersions, ({ one }) => ({
  item: one(items, { fields: [itemVersions.itemId], references: [items.id] }),
  changedBy: one(users, { fields: [itemVersions.changedById], references: [users.id] }),
}));

export const itemTaxonomyTagsRelations = relations(itemTaxonomyTags, ({ one }) => ({
  item: one(items, { fields: [itemTaxonomyTags.itemId], references: [items.id] }),
  node: one(taxonomyNodes, {
    fields: [itemTaxonomyTags.nodeId],
    references: [taxonomyNodes.id],
  }),
}));

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type ItemTaxonomyTag = typeof itemTaxonomyTags.$inferSelect;
export type NewItemTaxonomyTag = typeof itemTaxonomyTags.$inferInsert;
export type Rubric = typeof rubrics.$inferSelect;
export type NewRubric = typeof rubrics.$inferInsert;
