'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { apiPatch, apiPost } from '@/lib/api';
import {
  updateOrganizationProfileSchema,
  academicSetupSchema,
} from '@soe/types';
import type { UpdateOrganizationProfileDto, AcademicSetupDto } from '@soe/types';

async function getOrgId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.orgId) throw new Error('No autenticado');
  return session.user.orgId;
}

export async function updateOrgProfile(dto: UpdateOrganizationProfileDto) {
  const orgId = await getOrgId();
  const validated = updateOrganizationProfileSchema.parse(dto);
  await apiPatch(`/organizations/${orgId}`, validated);
  revalidatePath('/organizacion');
}

export async function setupAcademicYear(dto: AcademicSetupDto) {
  const orgId = await getOrgId();
  const validated = academicSetupSchema.parse(dto);
  const result = await apiPost<{
    academicYearId: string;
    classGroupsCreated: number;
    subjectClassesCreated: number;
  }>(`/organizations/${orgId}/setup`, validated);
  revalidatePath('/organizacion');
  return result;
}
