'use server';

import { revalidatePath } from 'next/cache';
import { ROUTES } from '@/lib/routes';
import { apiPost, apiPatch, apiDelete } from '@/lib/api';
import { getDisplayMessage } from '@/lib/errors';
import type {
  CreateItemCollectionDto,
  UpdateItemCollectionDto,
  MaterializeCollectionDto,
  ItemCollectionModel,
  ItemCollectionDetailModel,
  InstrumentModel,
} from '@soe/types';

export type CollectionActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

function revalidateCollections(collectionId?: string) {
  revalidatePath(ROUTES.bancoColecciones);
  revalidatePath(ROUTES.bancoItemsExplorar);
  if (collectionId) revalidatePath(ROUTES.bancoColeccion(collectionId));
}

export async function createCollection(
  input: CreateItemCollectionDto,
): Promise<CollectionActionResult<ItemCollectionModel>> {
  try {
    const data = await apiPost<ItemCollectionModel>('/item-collections', input);
    revalidateCollections();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: getDisplayMessage(error) };
  }
}

export async function createCollectionWithItems(
  input: CreateItemCollectionDto,
  itemIds: string[],
): Promise<CollectionActionResult<ItemCollectionDetailModel>> {
  try {
    const created = await apiPost<ItemCollectionModel>('/item-collections', input);
    const data = await apiPost<ItemCollectionDetailModel>(`/item-collections/${created.id}/items`, {
      itemIds,
    });
    revalidateCollections(created.id);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: getDisplayMessage(error) };
  }
}

export async function addItemsToCollection(
  collectionId: string,
  itemIds: string[],
): Promise<CollectionActionResult<ItemCollectionDetailModel>> {
  try {
    const data = await apiPost<ItemCollectionDetailModel>(
      `/item-collections/${collectionId}/items`,
      { itemIds },
    );
    revalidateCollections(collectionId);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: getDisplayMessage(error) };
  }
}

export async function removeItemFromCollection(
  collectionId: string,
  itemId: string,
): Promise<CollectionActionResult<null>> {
  try {
    await apiDelete(`/item-collections/${collectionId}/items/${itemId}`);
    revalidateCollections(collectionId);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, message: getDisplayMessage(error) };
  }
}

export async function updateCollection(
  collectionId: string,
  input: UpdateItemCollectionDto,
): Promise<CollectionActionResult<ItemCollectionDetailModel>> {
  try {
    const data = await apiPatch<ItemCollectionDetailModel>(
      `/item-collections/${collectionId}`,
      input,
    );
    revalidateCollections(collectionId);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: getDisplayMessage(error) };
  }
}

export async function deleteCollection(
  collectionId: string,
): Promise<CollectionActionResult<null>> {
  try {
    await apiDelete(`/item-collections/${collectionId}`);
    revalidateCollections(collectionId);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, message: getDisplayMessage(error) };
  }
}

export async function materializeCollection(
  collectionId: string,
  input: MaterializeCollectionDto,
): Promise<CollectionActionResult<InstrumentModel>> {
  try {
    const data = await apiPost<InstrumentModel>(
      `/item-collections/${collectionId}/materialize`,
      input,
    );
    revalidateCollections(collectionId);
    revalidatePath(ROUTES.bancoItems);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: getDisplayMessage(error) };
  }
}
