// Resuelve las bandas de logro EFECTIVAS de un instrumento con fallback a la
// versión anterior de su misma familia. Es la pieza central que decide qué
// corte de niveles se le aplica a un instrumento cuando él mismo no trae bandas
// propias. DEBE correr dentro de un `withOrgContext(...)`: reutiliza
// `loadBandsForInstruments`, que necesita el contexto RLS para ver las bandas
// globales (org_id NULL, cortes oficiales) junto con los overrides de la org.
//
// Cadena de precedencia:
//   1. Bandas propias del instrumento.
//   2. Bandas de la versión anterior: misma familia
//      (`type|subjectId|gradeId|applicationPeriod`, sin `year` ni `version`) con
//      el `year` estrictamente menor más reciente que SÍ tenga bandas.
//   3. Nada → `source: 'none'`, para que el caller caiga al legacy.

import { and, inArray, isNull } from 'drizzle-orm';
import { instruments } from '@soe/db';
import { buildInstrumentFamilyKey } from '@soe/types';
import type {
  ComparabilityInstrumentRef,
  InstrumentApplicationPeriod,
  PerformanceBandInput,
} from '@soe/types';
import type { Database } from '../../database/database.types';
import { loadBandsForInstruments } from './load-instrument-bands';

export type EffectiveBandsSource = 'own' | 'previous_version' | 'none';
export type EffectiveBands = { bands: PerformanceBandInput[]; source: EffectiveBandsSource };

const EMPTY: EffectiveBands = { bands: [], source: 'none' };

type InstrumentFamilyRow = {
  id: string;
  type: string;
  subjectId: string | null;
  gradeId: string | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  year: number | null;
};

const INSTRUMENT_FAMILY_COLUMNS = {
  id: instruments.id,
  type: instruments.type,
  subjectId: instruments.subjectId,
  gradeId: instruments.gradeId,
  applicationPeriod: instruments.applicationPeriod,
  year: instruments.year,
};

function toRef(row: InstrumentFamilyRow): ComparabilityInstrumentRef {
  return {
    instrumentId: row.id,
    type: row.type,
    subjectId: row.subjectId,
    gradeId: row.gradeId,
    applicationPeriod: row.applicationPeriod,
    year: row.year,
  };
}

function familyKeyOf(row: InstrumentFamilyRow): string {
  return buildInstrumentFamilyKey(toRef(row));
}

export async function resolveEffectiveBands(
  tx: Database,
  instrumentId: string,
): Promise<EffectiveBands> {
  const result = await resolveEffectiveBandsForInstruments(tx, [instrumentId]);
  return result.get(instrumentId) ?? EMPTY;
}

export async function resolveEffectiveBandsForInstruments(
  tx: Database,
  instrumentIds: readonly string[],
): Promise<Map<string, EffectiveBands>> {
  const resolved = new Map<string, EffectiveBands>();
  if (instrumentIds.length === 0) return resolved;

  const targets = await loadFamilyRows(tx, instrumentIds);
  const bandsByInstrument = await loadBandsForInstruments(tx, instrumentIds);

  const withoutOwnBands: InstrumentFamilyRow[] = [];
  for (const target of targets) {
    const ownBands = bandsByInstrument.get(target.id);
    if (ownBands && ownBands.length > 0) {
      resolved.set(target.id, { bands: ownBands, source: 'own' });
    } else {
      withoutOwnBands.push(target);
    }
  }

  if (withoutOwnBands.length === 0) return resolved;

  const previousBandsByInstrument = await resolvePreviousVersionBands(tx, withoutOwnBands);
  for (const target of withoutOwnBands) {
    resolved.set(target.id, previousBandsByInstrument.get(target.id) ?? EMPTY);
  }

  return resolved;
}

async function loadFamilyRows(
  tx: Database,
  instrumentIds: readonly string[],
): Promise<InstrumentFamilyRow[]> {
  return tx
    .select(INSTRUMENT_FAMILY_COLUMNS)
    .from(instruments)
    .where(and(inArray(instruments.id, [...instrumentIds]), isNull(instruments.deletedAt)));
}

async function resolvePreviousVersionBands(
  tx: Database,
  targets: readonly InstrumentFamilyRow[],
): Promise<Map<string, EffectiveBands>> {
  const familyKeys = new Set(targets.map(familyKeyOf));
  const candidates = await loadFamilyCandidates(tx, familyKeys);

  const candidatesByFamily = new Map<string, InstrumentFamilyRow[]>();
  const candidateIds: string[] = [];
  for (const candidate of candidates) {
    if (candidate.year === null) continue;
    candidateIds.push(candidate.id);
    const key = familyKeyOf(candidate);
    const bucket = candidatesByFamily.get(key);
    if (bucket) bucket.push(candidate);
    else candidatesByFamily.set(key, [candidate]);
  }

  const bandsByCandidate = await loadBandsForInstruments(tx, candidateIds);

  const resolved = new Map<string, EffectiveBands>();
  for (const target of targets) {
    const bands = pickPreviousVersionBands(target, candidatesByFamily, bandsByCandidate);
    if (bands) resolved.set(target.id, { bands, source: 'previous_version' });
  }
  return resolved;
}

async function loadFamilyCandidates(
  tx: Database,
  familyKeys: ReadonlySet<string>,
): Promise<InstrumentFamilyRow[]> {
  const rows = await tx
    .select(INSTRUMENT_FAMILY_COLUMNS)
    .from(instruments)
    .where(isNull(instruments.deletedAt));

  return rows.filter((row) => familyKeys.has(familyKeyOf(row)));
}

function pickPreviousVersionBands(
  target: InstrumentFamilyRow,
  candidatesByFamily: ReadonlyMap<string, InstrumentFamilyRow[]>,
  bandsByCandidate: ReadonlyMap<string, PerformanceBandInput[]>,
): PerformanceBandInput[] | null {
  if (target.year === null) return null;
  const family = candidatesByFamily.get(familyKeyOf(target));
  if (!family) return null;

  let bestYear = -Infinity;
  let bestBands: PerformanceBandInput[] | null = null;
  for (const candidate of family) {
    if (candidate.year === null || candidate.year >= target.year) continue;
    const bands = bandsByCandidate.get(candidate.id);
    if (!bands || bands.length === 0) continue;
    if (candidate.year > bestYear) {
      bestYear = candidate.year;
      bestBands = bands;
    }
  }
  return bestBands;
}
