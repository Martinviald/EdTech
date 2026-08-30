import 'server-only';
import { cache } from 'react';
import type { PrintRunAssessmentOption } from '@soe/types';
import { apiGet } from '@/lib/api';

/**
 * Evaluaciones que puede recibir una tirada: las del mismo instrumento del
 * layout impreso. `cache()` deduplica la llamada cuando varias secciones del
 * mismo request la piden (rule frontend/05 §3).
 */
export const listAssessmentOptions = cache(
  (instrumentId: string): Promise<PrintRunAssessmentOption[]> => {
    return apiGet<PrintRunAssessmentOption[]>(
      `/sheet-print-runs/assessment-options?instrumentId=${instrumentId}`,
    );
  },
);

export async function listAssessmentOptionsByInstrument(
  instrumentIds: readonly string[],
): Promise<Record<string, PrintRunAssessmentOption[]>> {
  const unique = Array.from(new Set(instrumentIds));
  const entries = await Promise.all(
    unique.map(async (instrumentId) => {
      try {
        return [instrumentId, await listAssessmentOptions(instrumentId)] as const;
      } catch {
        return [instrumentId, [] as PrintRunAssessmentOption[]] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}
