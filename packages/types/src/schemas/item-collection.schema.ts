import { z } from 'zod';
import { INSTRUMENT_TYPES } from '../enums';
import type { ItemModel } from './item.schema';

export const createItemCollectionSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(1000).optional(),
});

export const updateItemCollectionSchema = createItemCollectionSchema.partial();

export const addCollectionItemsSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(500),
});

export const itemCollectionListQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const materializeCollectionSchema = z.object({
  name: z.string().min(2).max(300).optional(),
  type: z.enum(INSTRUMENT_TYPES).optional(),
});

export type CreateItemCollectionDto = z.infer<typeof createItemCollectionSchema>;
export type UpdateItemCollectionDto = z.infer<typeof updateItemCollectionSchema>;
export type AddCollectionItemsDto = z.infer<typeof addCollectionItemsSchema>;
export type ItemCollectionListQueryDto = z.infer<typeof itemCollectionListQuerySchema>;
export type MaterializeCollectionDto = z.infer<typeof materializeCollectionSchema>;

export type ItemCollectionModel = {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  createdById: string | null;
  itemCount: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type ItemCollectionItemModel = {
  id: string;
  collectionId: string;
  itemId: string;
  position: number;
  createdAt: string | Date;
  /** Nombre del instrumento del que proviene el ítem. Null si el ítem es suelto. */
  instrumentName: string | null;
  item: ItemModel | null;
};

export type ItemCollectionDetailModel = ItemCollectionModel & {
  items: ItemCollectionItemModel[];
};

export type ItemCollectionListResponse = {
  data: ItemCollectionModel[];
  total: number;
  page: number;
  limit: number;
};
