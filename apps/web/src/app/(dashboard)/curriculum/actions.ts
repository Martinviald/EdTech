'use server';

import { revalidatePath } from 'next/cache';
import {
  createCurriculumSchema,
  createTaxonomyNodeSchema,
  updateCurriculumSchema,
  updateTaxonomyNodeSchema,
  type CreateCurriculumDto,
  type CreateTaxonomyNodeDto,
  type CurriculumModel,
  type TaxonomyNodeModel,
  type UpdateCurriculumDto,
  type UpdateTaxonomyNodeDto,
} from '@soe/types';
import { apiDelete, apiPatch, apiPost } from '@/lib/api';

export async function createCurriculum(dto: CreateCurriculumDto) {
  const validated = createCurriculumSchema.parse(dto);
  const created = await apiPost<CurriculumModel>('/taxonomies/curricula', validated);
  revalidatePath('/curriculum');
  return created;
}

export async function updateCurriculum(id: string, dto: UpdateCurriculumDto) {
  const validated = updateCurriculumSchema.parse(dto);
  const updated = await apiPatch<CurriculumModel>(`/taxonomies/curricula/${id}`, validated);
  revalidatePath('/curriculum');
  revalidatePath(`/curriculum/${id}`);
  return updated;
}

export async function deleteCurriculum(id: string) {
  await apiDelete(`/taxonomies/curricula/${id}`);
  revalidatePath('/curriculum');
}

export async function createTaxonomyNode(dto: CreateTaxonomyNodeDto) {
  const validated = createTaxonomyNodeSchema.parse(dto);
  const created = await apiPost<TaxonomyNodeModel>('/taxonomies/nodes', validated);
  revalidatePath(`/curriculum/${validated.curriculumId}`);
  return created;
}

export async function updateTaxonomyNode(
  id: string,
  curriculumId: string,
  dto: UpdateTaxonomyNodeDto,
) {
  const validated = updateTaxonomyNodeSchema.parse(dto);
  const updated = await apiPatch<TaxonomyNodeModel>(`/taxonomies/nodes/${id}`, validated);
  revalidatePath(`/curriculum/${curriculumId}`);
  return updated;
}

export async function deleteTaxonomyNode(id: string, curriculumId: string, cascade = false) {
  const qs = cascade ? '?cascade=true' : '';
  await apiDelete(`/taxonomies/nodes/${id}${qs}`);
  revalidatePath(`/curriculum/${curriculumId}`);
}
