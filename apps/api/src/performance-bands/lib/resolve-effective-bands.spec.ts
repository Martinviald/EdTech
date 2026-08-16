import type { Database } from '@soe/db';
import type { PerformanceBandInput } from '@soe/types';
import {
  resolveEffectiveBands,
  resolveEffectiveBandsForInstruments,
} from './resolve-effective-bands';

// ──────────────────────────────────────────────────────────────────────────────
// Mock de Database por escenario (mismo patrón que heatmap.service.spec):
// cada llamada a `select()` consume el siguiente array de `selectResults` en
// orden. El chain es encadenable y al resolver entrega las filas configuradas.
//
// Orden de queries en resolveEffectiveBandsForInstruments():
//   1. loadFamilyRows          → filas de familia de los instrumentos objetivo
//   2. loadBandsForInstruments → bandas propias de los objetivos
//   (si todos tienen bandas propias, termina acá)
//   3. loadFamilyCandidates    → todos los instrumentos vivos (se filtran por familia en memoria)
//   4. loadBandsForInstruments → bandas de los candidatos con year no nulo
//   (loadBandsForInstruments hace early-return SIN select cuando la lista de ids es vacía)
// ──────────────────────────────────────────────────────────────────────────────

type QueryBuilder = {
  from: (..._: unknown[]) => QueryBuilder;
  where: (..._: unknown[]) => QueryBuilder;
  orderBy: (..._: unknown[]) => QueryBuilder;
  then: <T>(resolve: (rows: T[]) => unknown) => Promise<unknown>;
};

function makeDb(selectResults: unknown[][]): Database {
  let selectIdx = 0;

  function buildSelectChain(rows: unknown[]): QueryBuilder {
    const chain: QueryBuilder = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      then: (resolve) => Promise.resolve(rows as never).then(resolve as never),
    };
    return chain;
  }

  const db = {
    select: () => {
      const rows = selectResults[selectIdx] ?? [];
      selectIdx++;
      return buildSelectChain(rows);
    },
  } as unknown as Database;

  return db;
}

function familyRow(
  id: string,
  year: number | null,
  overrides: Partial<{
    type: string;
    subjectId: string | null;
    gradeId: string | null;
    applicationPeriod: null;
  }> = {},
) {
  return {
    id,
    type: 'dia',
    subjectId: 's-leng',
    gradeId: 'g-6',
    applicationPeriod: null,
    year,
    ...overrides,
  };
}

function bandRow(instrumentId: string, key: string, order: number) {
  return {
    id: `band-${instrumentId}-${key}`,
    orgId: null,
    key,
    label: key,
    order,
    minThreshold: (order * 0.3).toFixed(2),
    maxThreshold: (order * 0.3 + 0.3).toFixed(2),
    color: null,
    instrumentId,
  };
}

function bandKeys(bands: PerformanceBandInput[]): string[] {
  return bands.map((b) => b.key);
}

describe('resolveEffectiveBands', () => {
  it('instrumento con bandas propias → source own', async () => {
    const db = makeDb([
      [familyRow('i1', 2026)],
      [bandRow('i1', 'adequate', 0), bandRow('i1', 'advanced', 1)],
    ]);

    const result = await resolveEffectiveBands(db, 'i1');

    expect(result.source).toBe('own');
    expect(bandKeys(result.bands)).toEqual(['adequate', 'advanced']);
  });

  it('sin bandas propias pero con versión anterior con bandas → source previous_version', async () => {
    const db = makeDb([
      [familyRow('i2', 2026)],
      [],
      [familyRow('i2', 2026), familyRow('i1', 2025), familyRow('i0', 2024)],
      [bandRow('i1', 'prev-2025', 0), bandRow('i0', 'prev-2024', 0)],
    ]);

    const result = await resolveEffectiveBands(db, 'i2');

    expect(result.source).toBe('previous_version');
    expect(bandKeys(result.bands)).toEqual(['prev-2025']);
  });

  it('sin bandas propias ni versión anterior → source none, bands vacío', async () => {
    const db = makeDb([[familyRow('i3', 2026)], [], [familyRow('i3', 2026)]]);

    const result = await resolveEffectiveBands(db, 'i3');

    expect(result.source).toBe('none');
    expect(result.bands).toEqual([]);
  });

  it('batch: mezcla de own, previous_version y none en una sola llamada', async () => {
    const db = makeDb([
      [
        familyRow('own', 2026, { subjectId: 's-own' }),
        familyRow('prev', 2026, { subjectId: 's-prev' }),
        familyRow('none', 2026, { subjectId: 's-none' }),
      ],
      [bandRow('own', 'own-band', 0)],
      [
        familyRow('own', 2026, { subjectId: 's-own' }),
        familyRow('prev', 2026, { subjectId: 's-prev' }),
        familyRow('none', 2026, { subjectId: 's-none' }),
        familyRow('prev-2025', 2025, { subjectId: 's-prev' }),
      ],
      [bandRow('prev-2025', 'prev-band', 0)],
    ]);

    const result = await resolveEffectiveBandsForInstruments(db, ['own', 'prev', 'none']);

    expect(result.get('own')?.source).toBe('own');
    expect(bandKeys(result.get('own')!.bands)).toEqual(['own-band']);

    expect(result.get('prev')?.source).toBe('previous_version');
    expect(bandKeys(result.get('prev')!.bands)).toEqual(['prev-band']);

    expect(result.get('none')?.source).toBe('none');
    expect(result.get('none')?.bands).toEqual([]);
  });

  it('elige la versión anterior con el year mayor entre las que tienen bandas', async () => {
    const db = makeDb([
      [familyRow('i2027', 2027)],
      [],
      [familyRow('i2027', 2027), familyRow('i2026', 2026), familyRow('i2025', 2025)],
      [bandRow('i2026', 'year-2026', 0), bandRow('i2025', 'year-2025', 0)],
    ]);

    const result = await resolveEffectiveBands(db, 'i2027');

    expect(result.source).toBe('previous_version');
    expect(bandKeys(result.bands)).toEqual(['year-2026']);
  });

  it('lista vacía → mapa vacío sin tocar la db', async () => {
    const db = makeDb([]);

    const result = await resolveEffectiveBandsForInstruments(db, []);

    expect(result.size).toBe(0);
  });
});
