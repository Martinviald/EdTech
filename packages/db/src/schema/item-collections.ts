import { integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations } from './organizations';
import { users } from './users';
import { items } from './items';

export const itemCollections = pgTable('item_collections', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  description: text('description'),
  createdById: uuid('created_by_id').references(() => users.id),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const itemCollectionItems = pgTable(
  'item_collection_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => itemCollections.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    position: integer('position').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.collectionId, table.itemId)],
);

export const itemCollectionsRelations = relations(itemCollections, ({ one, many }) => ({
  org: one(organizations, {
    fields: [itemCollections.orgId],
    references: [organizations.id],
  }),
  createdBy: one(users, {
    fields: [itemCollections.createdById],
    references: [users.id],
  }),
  items: many(itemCollectionItems),
}));

export const itemCollectionItemsRelations = relations(itemCollectionItems, ({ one }) => ({
  collection: one(itemCollections, {
    fields: [itemCollectionItems.collectionId],
    references: [itemCollections.id],
  }),
  item: one(items, {
    fields: [itemCollectionItems.itemId],
    references: [items.id],
  }),
}));

export type ItemCollection = typeof itemCollections.$inferSelect;
export type NewItemCollection = typeof itemCollections.$inferInsert;
export type ItemCollectionItem = typeof itemCollectionItems.$inferSelect;
export type NewItemCollectionItem = typeof itemCollectionItems.$inferInsert;
