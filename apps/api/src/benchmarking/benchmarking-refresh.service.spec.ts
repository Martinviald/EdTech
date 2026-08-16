import type { Database } from '@soe/db';
import { BenchmarkingRefreshService } from './benchmarking-refresh.service';

// ──────────────────────────────────────────────────────────────────────────────
// Mock de Database para el refresh.
//
// Orden de `db.select()`:
//   1. orgs (organizations type='school')
//   por cada org con datos:
//     a. deriveNetworkOrgId: parentId  (+ parent type si hay parent)
//     b. readOptOut (dentro de withOrgContext)
//     c. buildOrgRows.resultRows (por alumno × instrumento, dentro de withOrgContext)
//     d. resolveEffectiveBandsForInstruments (solo si resultRows.length > 0):
//        · loadFamilyRows          → filas de familia de los instrumentos objetivo
//        · loadBandsForInstruments → bandas propias de los objetivos
//        · loadFamilyCandidates    → todos los instrumentos vivos (solo si falta alguna banda propia)
//        · loadBandsForInstruments → bandas de los candidatos con year no nulo
//     e. buildOrgRows.perSkill
//
// `db.insert().values().onConflictDoUpdate()` registra el upsert.
// withOrgContext usa db.transaction → marca __transactionRan.
// ──────────────────────────────────────────────────────────────────────────────

type DbMock = Database & {
  __upserts: Array<{ values: unknown }>;
  __transactionRan: boolean;
};

function makeDb(selectResults: unknown[][]): DbMock {
  let idx = 0;
  const upserts: Array<{ values: unknown }> = [];

  function buildSelect(rows: unknown[]): unknown {
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'groupBy', 'orderBy', 'limit']) {
      chain[m] = passthrough;
    }
    chain.then = (resolve: (rows: unknown[]) => unknown) =>
      Promise.resolve(rows).then(resolve);
    return chain;
  }

  const db = {
    select: () => {
      const rows = selectResults[idx] ?? [];
      idx++;
      return buildSelect(rows);
    },
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: () => {
          upserts.push({ values });
          return Promise.resolve([]);
        },
      }),
    }),
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      db.__transactionRan = true;
      return fn(db);
    },
    __upserts: upserts,
    __transactionRan: false,
  } as unknown as DbMock;

  return db;
}

function makeService(db: Database): BenchmarkingRefreshService {
  return new (BenchmarkingRefreshService as new (
    db: Database,
  ) => BenchmarkingRefreshService)(db);
}

function resultRow(
  overrides: Partial<{
    instrumentId: string;
    gradeId: string | null;
    subjectId: string | null;
    gradingScaleConfig: unknown;
    studentId: string;
    percentage: string | null;
    performanceLevel: string | null;
  }> = {},
) {
  return {
    instrumentId: 'inst-1',
    gradeId: 'g1',
    subjectId: 's1',
    gradingScaleConfig: null,
    studentId: 'stu-1',
    percentage: '62.50',
    performanceLevel: null,
    ...overrides,
  };
}

function familyRow(id: string, year: number | null) {
  return {
    id,
    type: 'dia',
    subjectId: 's1',
    gradeId: 'g1',
    applicationPeriod: null,
    year,
  };
}

function bandRow(instrumentId: string, key: string, order: number, min: string, max: string) {
  return {
    id: `band-${instrumentId}-${key}`,
    orgId: null,
    key,
    label: key,
    order,
    minThreshold: min,
    maxThreshold: max,
    color: null,
    instrumentId,
  };
}

const THREE_BANDS = [
  bandRow('inst-1', 'nivel-1', 0, '0.00', '0.40'),
  bandRow('inst-1', 'nivel-2', 1, '0.40', '0.70'),
  bandRow('inst-1', 'nivel-3', 2, '0.70', '1.00'),
];

describe('BenchmarkingRefreshService.refresh', () => {
  it('agrega la fuente por org y hace upsert sin PII en el read-model', async () => {
    const db = makeDb([
      // orgs
      [
        {
          id: 'org-1',
          parentId: null,
          dependence: 'private',
          region: 'RM',
          commune: 'Santiago',
        },
      ],
      [{ optOut: false }], // readOptOut(org-1)
      // buildOrgRows.resultRows(org-1): 2 alumnos con % distintos.
      [
        resultRow({ studentId: 'stu-1', percentage: '30.00' }),
        resultRow({ studentId: 'stu-2', percentage: '80.00' }),
      ],
      // resolveEffectiveBands: familia + bandas propias del instrumento.
      [familyRow('inst-1', 2026)],
      THREE_BANDS,
      // perSkill(org-1)
      [
        {
          instrumentId: 'inst-1',
          nodeId: 'node-1',
          nodeName: 'Comprensión',
          achievement: '55.00',
          studentCount: 30,
        },
      ],
    ]);
    const svc = makeService(db);

    const res = await svc.refresh();

    expect(res.refreshedOrgs).toBe(1);
    expect(res.refreshedRows).toBe(1);
    expect(typeof res.refreshedAt).toBe('string');
    expect(db.__transactionRan).toBe(true);
    expect(db.__upserts).toHaveLength(1);

    const values = db.__upserts[0].values as Record<string, unknown>;
    expect(values.orgId).toBe('org-1');
    expect(values.instrumentId).toBe('inst-1');
    expect(values.optOutGlobalPool).toBe(false);
    expect(values.dependence).toBe('private');
    // Conteo de alumnos distintos y % promedio en memoria.
    expect(values.studentCount).toBe(2);
    expect(values.avgAchievement).toBe('55.00');
    // % 30 → nivel-1 (order 0) → insufficient; % 80 → nivel-3 (order 2) → advanced.
    expect(values.bandDistribution).toEqual({
      insufficient: 1,
      elementary: 0,
      adequate: 0,
      advanced: 1,
    });
    expect(values.perSkill).toEqual([
      { nodeId: 'node-1', nodeName: 'Comprensión', achievement: 55, studentCount: 30 },
    ]);
    expect(Object.keys(values)).not.toContain('studentId');
    expect(Object.keys(values)).not.toContain('studentName');
  });

  it('sin bandas efectivas (source none) clasifica por el corte legacy 40/70/85', async () => {
    const db = makeDb([
      [{ id: 'org-1', parentId: null, dependence: null, region: null, commune: null }],
      [{ optOut: false }],
      // Un alumno por cada bucket legacy: 30 insufficient, 55 elementary, 78 adequate, 90 advanced.
      [
        resultRow({ studentId: 'a', percentage: '30.00' }),
        resultRow({ studentId: 'b', percentage: '55.00' }),
        resultRow({ studentId: 'c', percentage: '78.00' }),
        resultRow({ studentId: 'd', percentage: '90.00' }),
      ],
      // resolveEffectiveBands: sin bandas propias ni versión anterior → source none.
      [familyRow('inst-1', 2026)], // loadFamilyRows
      [], // loadBandsForInstruments(targets): sin bandas propias
      [familyRow('inst-1', 2026)], // loadFamilyCandidates: solo el propio, sin previa
      [], // loadBandsForInstruments(candidatos): sin bandas
      [], // perSkill
    ]);
    const svc = makeService(db);

    await svc.refresh();

    const values = db.__upserts[0].values as { bandDistribution: unknown };
    expect(values.bandDistribution).toEqual({
      insufficient: 1,
      elementary: 1,
      adequate: 1,
      advanced: 1,
    });
  });

  it('sin bandas propias usa las de la versión anterior de su familia', async () => {
    const db = makeDb([
      [{ id: 'org-1', parentId: null, dependence: null, region: null, commune: null }],
      [{ optOut: false }],
      // % 30 y % 90 sobre bandas de 3 niveles heredadas.
      [
        resultRow({ instrumentId: 'inst-1', studentId: 'a', percentage: '30.00' }),
        resultRow({ instrumentId: 'inst-1', studentId: 'b', percentage: '90.00' }),
      ],
      // resolveEffectiveBands: sin bandas propias, con versión anterior con bandas.
      [familyRow('inst-1', 2026)],
      [], // sin bandas propias
      [familyRow('inst-1', 2026), familyRow('inst-0', 2025)], // candidatos
      [
        bandRow('inst-0', 'nivel-1', 0, '0.00', '0.40'),
        bandRow('inst-0', 'nivel-2', 1, '0.40', '0.70'),
        bandRow('inst-0', 'nivel-3', 2, '0.70', '1.00'),
      ],
    ]);
    const svc = makeService(db);

    await svc.refresh();

    const values = db.__upserts[0].values as { bandDistribution: unknown };
    // % 30 → nivel-1 → insufficient; % 90 → nivel-3 → advanced.
    expect(values.bandDistribution).toEqual({
      insufficient: 1,
      elementary: 0,
      adequate: 0,
      advanced: 1,
    });
  });

  it('cuenta las filas band-only (percentage NULL) por su nivel persistido', async () => {
    const db = makeDb([
      [{ id: 'org-1', parentId: null, dependence: null, region: null, commune: null }],
      [{ optOut: false }],
      [
        resultRow({ studentId: 'a', percentage: null, performanceLevel: 'insufficient' }),
        resultRow({ studentId: 'b', percentage: null, performanceLevel: 'advanced' }),
      ],
      [familyRow('inst-1', 2026)],
      THREE_BANDS,
    ]);
    const svc = makeService(db);

    await svc.refresh();

    const values = db.__upserts[0].values as {
      bandDistribution: unknown;
      avgAchievement: string | null;
    };
    expect(values.bandDistribution).toEqual({
      insufficient: 1,
      elementary: 0,
      adequate: 0,
      advanced: 1,
    });
    // Sin ningún percentage → avgAchievement null.
    expect(values.avgAchievement).toBeNull();
  });

  it('snapshotea optOutGlobalPool=true de org_benchmark_settings', async () => {
    const db = makeDb([
      [{ id: 'org-1', parentId: null, dependence: null, region: null, commune: null }],
      [{ optOut: true }],
      [resultRow({ percentage: '50.00' })],
      [familyRow('inst-1', 2026)],
      THREE_BANDS,
      [], // perSkill vacío
    ]);
    const svc = makeService(db);

    await svc.refresh();

    const values = db.__upserts[0].values as { optOutGlobalPool: boolean };
    expect(values.optOutGlobalPool).toBe(true);
  });

  it('deriva networkOrgId solo si el parent es foundation', async () => {
    const db = makeDb([
      [{ id: 'org-1', parentId: 'p1', dependence: null, region: null, commune: null }],
      [{ id: 'p1', type: 'foundation' }], // deriveNetworkOrgId: parent foundation
      [{ optOut: false }],
      [resultRow({ percentage: '50.00' })],
      [familyRow('inst-1', 2026)],
      THREE_BANDS,
      [],
    ]);
    const svc = makeService(db);

    await svc.refresh();

    const values = db.__upserts[0].values as { networkOrgId: string | null };
    expect(values.networkOrgId).toBe('p1');
  });

  it('itera varias orgs y omite las que no tienen datos en la fuente', async () => {
    const db = makeDb([
      // orgs (2)
      [
        { id: 'org-1', parentId: null, dependence: null, region: null, commune: null },
        { id: 'org-2', parentId: null, dependence: null, region: null, commune: null },
      ],
      // org-1
      [{ optOut: false }],
      [resultRow({ percentage: '50.00' })],
      [familyRow('inst-1', 2026)],
      THREE_BANDS,
      [],
      // org-2 — sin datos en resultRows (no se resuelven bandas ni perSkill)
      [{ optOut: false }],
      [],
    ]);
    const svc = makeService(db);

    const res = await svc.refresh();

    expect(res.refreshedOrgs).toBe(1); // solo org-1 produjo filas
    expect(res.refreshedRows).toBe(1);
    expect(db.__upserts).toHaveLength(1);
  });
});
