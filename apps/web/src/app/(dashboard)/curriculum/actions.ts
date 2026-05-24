'use server';

import { revalidatePath } from 'next/cache';
import {
  createCurriculumSchema,
  createTaxonomyNodeSchema,
  updateCurriculumSchema,
  updateTaxonomyNodeSchema,
  type CreateCurriculumDto,
  type CreateTaxonomyNodeDto,
  type UpdateCurriculumDto,
  type UpdateTaxonomyNodeDto,
} from '@soe/types';
import type { Curriculum, TaxonomyNode } from '@soe/db';
import { apiFetch } from '@/lib/api-client';

export async function createCurriculum(dto: CreateCurriculumDto) {
  const validated = createCurriculumSchema.parse(dto);
  const created = await apiFetch<Curriculum>('/taxonomies/curricula', {
    method: 'POST',
    body: validated,
  });
  revalidatePath('/curriculum');
  return created;
}

export async function updateCurriculum(id: string, dto: UpdateCurriculumDto) {
  const validated = updateCurriculumSchema.parse(dto);
  const updated = await apiFetch<Curriculum>(`/taxonomies/curricula/${id}`, {
    method: 'PATCH',
    body: validated,
  });
  revalidatePath('/curriculum');
  revalidatePath(`/curriculum/${id}`);
  return updated;
}

export async function deleteCurriculum(id: string) {
  await apiFetch<void>(`/taxonomies/curricula/${id}`, { method: 'DELETE' });
  revalidatePath('/curriculum');
}

export async function createTaxonomyNode(dto: CreateTaxonomyNodeDto) {
  const validated = createTaxonomyNodeSchema.parse(dto);
  const created = await apiFetch<TaxonomyNode>('/taxonomies/nodes', {
    method: 'POST',
    body: validated,
  });
  revalidatePath(`/curriculum/${validated.curriculumId}`);
  return created;
}

export async function updateTaxonomyNode(
  id: string,
  curriculumId: string,
  dto: UpdateTaxonomyNodeDto,
) {
  const validated = updateTaxonomyNodeSchema.parse(dto);
  const updated = await apiFetch<TaxonomyNode>(`/taxonomies/nodes/${id}`, {
    method: 'PATCH',
    body: validated,
  });
  revalidatePath(`/curriculum/${curriculumId}`);
  return updated;
}

export async function deleteTaxonomyNode(id: string, curriculumId: string, cascade = false) {
  const qs = cascade ? '?cascade=true' : '';
  await apiFetch<void>(`/taxonomies/nodes/${id}${qs}`, { method: 'DELETE' });
  revalidatePath(`/curriculum/${curriculumId}`);
}
