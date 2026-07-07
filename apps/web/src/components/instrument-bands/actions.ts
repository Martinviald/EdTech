'use server';

import { revalidatePath } from 'next/cache';
import {
  upsertInstrumentBandsSchema,
  type PerformanceBandListResponse,
  type UpsertInstrumentBandsDto,
} from '@soe/types';
import { apiPut } from '@/lib/api';

/**
 * Reemplaza el set completo de bandas de logro (niveles/umbrales) de un
 * instrumento. Bandas GLOBALES (compartidas por todas las orgs); sólo
 * platform_admin (gate en el backend). Revalida la lista y el editor.
 */
export async function upsertInstrumentBandsAction(
  instrumentId: string,
  input: UpsertInstrumentBandsDto,
): Promise<PerformanceBandListResponse> {
  const validated = upsertInstrumentBandsSchema.parse(input);
  const res = await apiPut<PerformanceBandListResponse>(
    `/instruments/${instrumentId}/performance-bands`,
    validated,
  );
  revalidatePath('/admin/instrumentos-bandas');
  revalidatePath(`/admin/instrumentos-bandas/${instrumentId}`);
  return res;
}
