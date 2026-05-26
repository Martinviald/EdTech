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
  return apiPost<AiTaggingResponse>('/items/ai-tagging', data);
}

export async function confirmTags(data: BatchTagItemsDto) {
  const result = await apiPost<{ created: number }>('/items/tags/bulk', data);
  revalidatePath('/banco-items');
  return result;
}
