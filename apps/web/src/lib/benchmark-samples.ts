import 'server-only';
import { cache } from 'react';
import {
  BENCHMARK_SAMPLES_MAX_INSTRUMENTS,
  BENCHMARKING_VIEWER_ROLES,
  canAccess,
  type InstrumentItemSamples,
  type InstrumentItemSamplesResponse,
  type InstrumentSampleEntry,
  type InstrumentSamplesResponse,
  type UserRole,
} from '@soe/types';
import { apiGet } from '@/lib/api';
import { reportServerError } from '@/lib/observability';

export type InstrumentSampleMap = ReadonlyMap<string, InstrumentSampleEntry>;

const EMPTY: InstrumentSampleMap = new Map();

/**
 * Muestra de benchmarking por instrumento (docs/diseno-benchmarking-en-contexto.md §8).
 *
 * `cache()` deduplica por request: un layout y su page que piden los mismos
 * instrumentos hacen una sola llamada. La clave es el string ordenado de ids porque
 * `cache` compara argumentos por identidad.
 *
 * Nunca falla: si la API no responde, la vista sigue sin contraste.
 */
const fetchSamples = cache(async (joinedIds: string): Promise<InstrumentSampleMap> => {
  try {
    const response = await apiGet<InstrumentSamplesResponse>(
      `/benchmarking/samples?instrumentIds=${joinedIds}`,
    );
    return new Map(response.data.map((entry) => [entry.instrumentId, entry]));
  } catch (error) {
    reportServerError(error, { operation: 'benchmark-samples', instrumentIds: joinedIds });
    return EMPTY;
  }
});

export function canSeeBenchmark(roles: readonly UserRole[]): boolean {
  return canAccess(roles, BENCHMARKING_VIEWER_ROLES);
}

export async function getInstrumentSamples(
  instrumentIds: readonly (string | null | undefined)[],
): Promise<InstrumentSampleMap> {
  const ids = Array.from(
    new Set(instrumentIds.filter((id): id is string => typeof id === 'string' && id.length > 0)),
  )
    .sort()
    .slice(0, BENCHMARK_SAMPLES_MAX_INSTRUMENTS);
  if (ids.length === 0) return EMPTY;
  return fetchSamples(ids.join(','));
}

export async function getInstrumentSample(
  instrumentId: string | null | undefined,
): Promise<InstrumentSampleEntry | null> {
  if (!instrumentId) return null;
  const samples = await getInstrumentSamples([instrumentId]);
  return samples.get(instrumentId) ?? null;
}

const fetchItemSamples = cache(
  async (instrumentId: string): Promise<InstrumentItemSamples | null> => {
    try {
      const response = await apiGet<InstrumentItemSamplesResponse>(
        `/benchmarking/samples/items?instrumentIds=${instrumentId}`,
      );
      return response.data.find((sample) => sample.instrumentId === instrumentId) ?? null;
    } catch (error) {
      reportServerError(error, { operation: 'benchmark-item-samples', instrumentId });
      return null;
    }
  },
);

/** % de acierto de la muestra por ítem del instrumento (itemId → %), o null si no hay muestra. */
export async function getItemSampleRates(
  instrumentId: string | null | undefined,
): Promise<ReadonlyMap<string, number | null> | null> {
  if (!instrumentId) return null;
  const sample = await fetchItemSamples(instrumentId);
  return sample ? new Map(sample.items.map((item) => [item.itemId, item.correctRate])) : null;
}
