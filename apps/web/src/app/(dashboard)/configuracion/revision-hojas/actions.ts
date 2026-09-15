'use server';

import { revalidatePath } from 'next/cache';
import { apiPatch } from '@/lib/api';
import { getDisplayMessage } from '@/lib/errors';
import { ROUTES } from '@/lib/routes';
import type { OrgReviewSettingsResponse, UpdateOrgReviewSettingsDto } from '@soe/types';

export type ReviewSettingsSaveResult =
  | { ok: true; data: OrgReviewSettingsResponse }
  | { ok: false; message: string };

export async function saveReviewSettings(
  dto: UpdateOrgReviewSettingsDto,
): Promise<ReviewSettingsSaveResult> {
  try {
    const data = await apiPatch<OrgReviewSettingsResponse>(
      '/organizations/me/review-settings',
      dto,
    );
    revalidatePath(ROUTES.configRevisionHojas);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: getDisplayMessage(e, 'No se pudieron guardar los ajustes.') };
  }
}
