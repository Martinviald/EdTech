'use server';

import { revalidatePath } from 'next/cache';
import { apiPatch, apiPost } from '@/lib/api';
import {
  academicSetupSchema,
  updateOrganizationProfileSchema,
} from '@soe/types';
import type { AcademicSetupDto, UpdateOrganizationProfileDto } from '@soe/types';

/**
 * Variantes admin de las acciones de setup: en vez de tomar el orgId del JWT
 * (como las de `/organizacion/configurar`), reciben el orgId como primer
 * argumento para que `.bind(null, orgId)` produzca una acción específica del
 * colegio elegido en el path admin.
 */
export async function adminUpdateOrgProfileAction(
  orgId: string,
  dto: UpdateOrganizationProfileDto,
) {
  const validated = updateOrganizationProfileSchema.parse(dto);
  await apiPatch(`/organizations/${orgId}`, validated);
  revalidatePath(`/admin/colegios/${orgId}`);
}

export async function adminSetupAcademicYearAction(orgId: string, dto: AcademicSetupDto) {
  const validated = academicSetupSchema.parse(dto);
  const result = await apiPost<{
    academicYearId: string;
    classGroupsCreated: number;
    subjectClassesCreated: number;
  }>(`/organizations/${orgId}/setup`, validated);
  revalidatePath(`/admin/colegios/${orgId}`);
  revalidatePath(`/admin/colegios/${orgId}/cursos`);
  revalidatePath(`/admin/colegios/${orgId}/asignaturas`);
  return result;
}
