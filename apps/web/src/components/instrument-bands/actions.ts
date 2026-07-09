'use server';

import { revalidatePath } from 'next/cache';
import {
  upsertInstrumentBandsSchema,
  type PerformanceBandListResponse,
  type RecalculateInstrumentBandsResponse,
  type UpsertInstrumentBandsDto,
} from '@soe/types';
import { apiPost, apiPut } from '@/lib/api';

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

/**
 * Dispara el recálculo de los resultados de todas las evaluaciones (todos los
 * colegios) que usan el instrumento, para que sus gráficos reflejen las bandas
 * recién guardadas. Idempotente: se puede reintentar sin efectos adversos.
 */
export async function recalculateInstrumentBandsAction(
  instrumentId: string,
): Promise<RecalculateInstrumentBandsResponse> {
  return apiPost<RecalculateInstrumentBandsResponse>(
    `/instruments/${instrumentId}/performance-bands/recalculate`,
    {},
  );
}
