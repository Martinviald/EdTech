'use server';

import { revalidatePath } from 'next/cache';
import {
  createTaxonomySchema,
  createTaxonomyNodeSchema,
  updateTaxonomySchema,
  updateTaxonomyNodeSchema,
  type CreateTaxonomyDto,
  type CreateTaxonomyNodeDto,
  type TaxonomyModel,
  type TaxonomyNodeModel,
  type UpdateTaxonomyDto,
  type UpdateTaxonomyNodeDto,
} from '@soe/types';
import { apiDelete, apiPatch, apiPost } from '@/lib/api';

export async function createTaxonomy(dto: CreateTaxonomyDto) {
  const validated = createTaxonomySchema.parse(dto);
  const created = await apiPost<TaxonomyModel>('/taxonomies', validated);
  revalidatePath('/marcos-academicos');
  return created;
}

export async function updateTaxonomy(id: string, dto: UpdateTaxonomyDto) {
  const validated = updateTaxonomySchema.parse(dto);
  const updated = await apiPatch<TaxonomyModel>(`/taxonomies/${id}`, validated);
  revalidatePath('/marcos-academicos');
  revalidatePath(`/marcos-academicos/${id}`);
  return updated;
}

export async function deleteTaxonomy(id: string) {
  await apiDelete(`/taxonomies/${id}`);
  revalidatePath('/marcos-academicos');
}

export async function createTaxonomyNode(dto: CreateTaxonomyNodeDto) {
  const validated = createTaxonomyNodeSchema.parse(dto);
  const created = await apiPost<TaxonomyNodeModel>('/taxonomies/nodes', validated);
  revalidatePath(`/marcos-academicos/${validated.taxonomyId}`);
  return created;
}

export async function updateTaxonomyNode(
  id: string,
  taxonomyId: string,
  dto: UpdateTaxonomyNodeDto,
) {
  const validated = updateTaxonomyNodeSchema.parse(dto);
  const updated = await apiPatch<TaxonomyNodeModel>(`/taxonomies/nodes/${id}`, validated);
  revalidatePath(`/marcos-academicos/${taxonomyId}`);
  return updated;
}

export async function deleteTaxonomyNode(id: string, taxonomyId: string, cascade = false) {
  const qs = cascade ? '?cascade=true' : '';
  await apiDelete(`/taxonomies/nodes/${id}${qs}`);
  revalidatePath(`/marcos-academicos/${taxonomyId}`);
}
