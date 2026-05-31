'use server';

import { revalidatePath } from 'next/cache';
import {
  gradingScaleCreateSchema,
  gradingScaleUpdateSchema,
  gradingScalePreviewRequestSchema,
  type GradingScaleCreateDto,
  type GradingScaleUpdateDto,
  type GradingScaleResponseModel,
  type GradingScalePreviewResponse,
} from '@soe/types';
import { apiPost, apiPatch, apiDelete } from '@/lib/api';

export async function createGradingScaleAction(
  input: GradingScaleCreateDto,
): Promise<GradingScaleResponseModel> {
  const validated = gradingScaleCreateSchema.parse(input);
  const created = await apiPost<GradingScaleResponseModel>('/grading-scales', validated);
  revalidatePath('/configuracion/escalas');
  return created;
}

export async function updateGradingScaleAction(
  id: string,
  input: GradingScaleUpdateDto,
): Promise<GradingScaleResponseModel> {
  const validated = gradingScaleUpdateSchema.parse(input);
  const updated = await apiPatch<GradingScaleResponseModel>(
    `/grading-scales/${id}`,
    validated,
  );
  revalidatePath('/configuracion/escalas');
  revalidatePath(`/configuracion/escalas/${id}`);
  return updated;
}

export async function deleteGradingScaleAction(id: string): Promise<void> {
  await apiDelete(`/grading-scales/${id}`);
  revalidatePath('/configuracion/escalas');
}

export async function previewConversionAction(
  id: string,
  percentages: number[],
): Promise<GradingScalePreviewResponse> {
  const validated = gradingScalePreviewRequestSchema.parse({ percentages });
  return apiPost<GradingScalePreviewResponse>(`/grading-scales/${id}/preview`, validated);
}
