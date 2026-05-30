'use server';

import { revalidatePath } from 'next/cache';
import { apiPost, apiPatch, apiDelete } from '@/lib/api';
import type {
  CreateInstrumentDto,
  UpdateInstrumentDto,
  InstrumentModel,
  BatchTagItemsDto,
  AiTagRequestDto,
  AiTagSuggestion,
} from '@soe/types';

/** Response shape from the AI tagging endpoint: suggestions grouped by itemId */
export type AiTaggingResponse = {
  suggestions: Record<string, AiTagSuggestion[]>;
};

export async function createInstrument(data: CreateInstrumentDto) {
  const result = await apiPost<InstrumentModel>('/instruments', data);
  revalidatePath('/banco-items');
  return result;
}

export async function updateInstrument(id: string, data: UpdateInstrumentDto) {
  const result = await apiPatch<InstrumentModel>(`/instruments/${id}`, data);
  revalidatePath('/banco-items');
  revalidatePath(`/banco-items/${id}`);
  return result;
}

export async function deleteInstrument(id: string) {
  await apiDelete(`/instruments/${id}`);
  revalidatePath('/banco-items');
}

export async function requestAiTagging(data: AiTagRequestDto) {
  return apiPost<AiTaggingResponse>('/ai-tagging/suggest', data);
}

/** Result of confirming AI-suggested tags. */
export type ConfirmTagsResponse = { applied: number; rejected: number };

export async function confirmTags(data: BatchTagItemsDto) {
  // El backend persiste las sugerencias confirmadas vía POST /ai-tagging/confirm,
  // que las guarda con taggedBy='ai'. Espera { tags: [{ itemId, nodeId, tagType,
  // confirmed }] }, así que mapeamos los CreateItemTagDto (que traen confidence/
  // taggedBy) a esa forma y marcamos confirmed=true.
  const payload = {
    tags: data.tags.map((t) => ({
      itemId: t.itemId,
      nodeId: t.nodeId,
      tagType: t.tagType ?? 'primary',
      confirmed: true,
    })),
  };
  const result = await apiPost<ConfirmTagsResponse>('/ai-tagging/confirm', payload);
  revalidatePath('/banco-items');
  return result;
}
