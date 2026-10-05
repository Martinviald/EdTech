import type { Database } from '@soe/db';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { BenchmarkSamplesService } from './benchmark-samples.service';

type DbMock = Database & { __inserts: Array<{ values: unknown }> };

function makeDb(selectResults: unknown[][]): DbMock {
  let idx = 0;
  const inserts: Array<{ values: unknown }> = [];

  function buildSelect(rows: unknown[]): unknown {
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit']) {
      chain[m] = passthrough;
    }
    chain.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
    return chain;
  }

  const db = {
    select: () => {
      const rows = selectResults[idx] ?? [];
      idx++;
      return buildSelect(rows);
    },
    insert: () => ({
      values: (values: unknown) => {
        inserts.push({ values });
        return Promise.resolve([]);
      },
    }),
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    __inserts: inserts,
  } as unknown as DbMock;
  return db;
}

const INSTRUMENT = '11111111-1111-4111-8111-111111111111';
const OTHER_INSTRUMENT = '22222222-2222-4222-8222-222222222222';
const NETWORK = 'f0000000-0000-4000-8000-0000000000f0';

const DIA_BANDS = (i: number, ii: number, iii: number) => [
  { bandKey: 'dia_nivel_1', label: 'Nivel I', order: 1, count: i },
  { bandKey: 'dia_nivel_2', label: 'Nivel II', order: 2, count: ii },
  { bandKey: 'dia_nivel_3', label: 'Nivel III', order: 3, count: iii },
];

function aggRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row',
    orgId: 'org-you',
    instrumentId: INSTRUMENT,
    gradeId: 'g',
    subjectId: 's',
    dependence: null,
    region: null,
    commune: null,
    networkOrgId: null,
    studentCount: 20,
    avgAchievement: '60.00',
    bandDistribution: null,
    bandCounts: DIA_BANDS(2, 10, 8),
    perSkill: [],
    optOutGlobalPool: false,
    refreshedAt: new Date('2026-10-05T06:30:00Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    userId: 'user-1',
    orgId: 'org-you',
    email: 't@x.cl',
    name: 'Tester',
    roles: ['academic_director'],
    activeRole: 'academic_director',
    role: 'academic_director',
    isPlatformAdmin: false,
    ...overrides,
  };
}

function makeService(db: Database): BenchmarkSamplesService {
  return new (BenchmarkSamplesService as new (db: Database) => BenchmarkSamplesService)(db);
}

describe('BenchmarkSamplesService.getSamples', () => {
  it('arma la muestra global con el propio colegio y su posición', async () => {
    const db = makeDb([
      [
        aggRow({
          orgId: 'org-you',
          studentCount: 18,
          avgAchievement: '73.70',
          bandCounts: DIA_BANDS(0, 9, 9),
        }),
        aggRow({
          orgId: 'org-b',
          studentCount: 85,
          avgAchievement: '71.53',
          bandCounts: DIA_BANDS(10, 35, 40),
        }),
      ],
      [{ parentId: null }],
    ]);

    const [entry] = await makeService(db).getSamples('org-you', [INSTRUMENT]);

    expect(entry!.global).toMatchObject({
      scope: 'global',
      label: 'Muestra',
      schoolCount: 2,
      studentCount: 103,
      avgAchievement: 71.91,
      bandCounts: DIA_BANDS(10, 44, 49),
      refreshedAt: '2026-10-05T06:30:00.000Z',
    });
    expect(entry!.network).toBeNull();
    expect(entry!.you).toEqual({
      avgAchievement: 73.7,
      studentCount: 18,
      percentile: 75,
      typicalZone: 'above',
    });
  });

  it('suprime la global bajo k-anonimato pero mantiene la posición sin percentil', async () => {
    const db = makeDb([[aggRow({ orgId: 'org-you' })], [{ parentId: null }]]);

    const [entry] = await makeService(db).getSamples('org-you', [INSTRUMENT]);

    expect(entry!.global).toBeNull();
    expect(entry!.you).toMatchObject({ avgAchievement: 60, percentile: null, typicalZone: null });
  });

  it('excluye del pool global a los colegios con opt-out, pero no de la red', async () => {
    const db = makeDb([
      [
        aggRow({ orgId: 'org-you', networkOrgId: NETWORK }),
        aggRow({ orgId: 'org-b', networkOrgId: NETWORK, optOutGlobalPool: true }),
        aggRow({ orgId: 'org-c' }),
      ],
      [{ parentId: NETWORK }],
      [{ id: NETWORK, name: 'Fundación Tupungato', type: 'foundation' }],
    ]);

    const [entry] = await makeService(db).getSamples('org-you', [INSTRUMENT]);

    expect(entry!.global!.schoolCount).toBe(2);
    expect(entry!.network).toMatchObject({
      scope: 'network',
      label: 'Fundación Tupungato',
      schoolCount: 2,
    });
  });

  it('no arma red si el padre no es una fundación', async () => {
    const db = makeDb([
      [aggRow({ orgId: 'org-you' }), aggRow({ orgId: 'org-b' })],
      [{ parentId: 'parent' }],
      [{ id: 'parent', name: 'Otra', type: 'school' }],
    ]);

    const [entry] = await makeService(db).getSamples('org-you', [INSTRUMENT]);

    expect(entry!.network).toBeNull();
    expect(entry!.global).not.toBeNull();
  });

  it('devuelve una entrada por instrumento pedido, también sin datos, sin duplicados', async () => {
    const db = makeDb([
      [aggRow({ orgId: 'org-b' }), aggRow({ orgId: 'org-c' })],
      [{ parentId: null }],
    ]);

    const entries = await makeService(db).getSamples('org-you', [
      INSTRUMENT,
      OTHER_INSTRUMENT,
      INSTRUMENT,
    ]);

    expect(entries.map((e) => e.instrumentId)).toEqual([INSTRUMENT, OTHER_INSTRUMENT]);
    expect(entries[0]!.you).toBeNull();
    expect(entries[0]!.global!.schoolCount).toBe(2);
    expect(entries[1]).toEqual({
      instrumentId: OTHER_INSTRUMENT,
      global: null,
      network: null,
      you: null,
    });
  });

  it('sin instrumentos no consulta la base', async () => {
    const db = makeDb([]);
    const select = jest.spyOn(db, 'select');

    await expect(makeService(db).getSamples('org-you', [])).resolves.toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });
});

describe('BenchmarkSamplesService.getSamplesForUser', () => {
  it('escribe un solo registro de auditoría por request', async () => {
    const db = makeDb([
      [aggRow({ orgId: 'org-b' }), aggRow({ orgId: 'org-c' })],
      [{ parentId: null }],
    ]);

    const res = await makeService(db).getSamplesForUser(makeUser(), {
      instrumentIds: [INSTRUMENT, OTHER_INSTRUMENT],
    });

    expect(res.data).toHaveLength(2);
    expect(db.__inserts).toHaveLength(1);
    expect(db.__inserts[0]!.values).toMatchObject({
      orgId: 'org-you',
      userId: 'user-1',
      mode: 'global',
      filters: { instrumentIds: [INSTRUMENT, OTHER_INSTRUMENT] },
    });
  });

  it('rechaza a un usuario sin organización activa', async () => {
    const db = makeDb([]);
    await expect(
      makeService(db).getSamplesForUser(makeUser({ orgId: null }), { instrumentIds: [INSTRUMENT] }),
    ).rejects.toThrow('Usuario sin organización activa');
  });
});

const ITEM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ITEM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'org-a',
    instrumentId: INSTRUMENT,
    itemId: ITEM_A,
    correctCount: 30,
    responseCount: 80,
    refreshedAt: new Date('2026-10-05T06:30:00Z'),
    ...overrides,
  };
}

describe('BenchmarkSamplesService.getItemSamples', () => {
  it('agrega el % de acierto por ítem de todos los colegios del instrumento', async () => {
    const db = makeDb([
      [
        itemRow(),
        itemRow({ itemId: ITEM_B, correctCount: 70, responseCount: 85 }),
        itemRow({ orgId: 'org-b', correctCount: 6, responseCount: 18 }),
      ],
    ]);

    const [sample] = await makeService(db).getItemSamples([INSTRUMENT]);

    expect(sample).toMatchObject({
      instrumentId: INSTRUMENT,
      schoolCount: 2,
      studentCount: 103,
      refreshedAt: '2026-10-05T06:30:00.000Z',
    });
    const byItem = new Map(sample!.items.map((i) => [i.itemId, i]));
    expect(byItem.get(ITEM_A)).toMatchObject({ correctRate: 36.73, schoolCount: 2 });
    expect(byItem.get(ITEM_B)).toMatchObject({ correctRate: 82.35, schoolCount: 1 });
  });

  it('omite los instrumentos que no cumplen k-anonimato', async () => {
    const db = makeDb([[itemRow(), itemRow({ itemId: ITEM_B })]]);

    await expect(makeService(db).getItemSamples([INSTRUMENT])).resolves.toEqual([]);
  });

  it('sin instrumentos no consulta la base', async () => {
    const db = makeDb([]);
    const select = jest.spyOn(db, 'select');

    await expect(makeService(db).getItemSamples([])).resolves.toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });
});
