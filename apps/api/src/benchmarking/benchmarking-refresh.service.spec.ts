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
//     c. buildOrgRows.base (dentro de withOrgContext)
//     d. buildOrgRows.perSkill (solo si base.length > 0)
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
    for (const m of ['from', 'innerJoin', 'where', 'groupBy', 'limit']) {
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
      // buildOrgRows.base(org-1)
      [
        {
          instrumentId: 'inst-1',
          gradeId: 'g1',
          subjectId: 's1',
          studentCount: 30,
          avgAchievement: '62.50',
          insufficient: 5,
          elementary: 10,
          adequate: 10,
          advanced: 5,
        },
      ],
      // buildOrgRows.perSkill(org-1)
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
    // Snapshot de dimensiones + opt-out, sin PII (sin studentId/nombres/RUT).
    expect(values.orgId).toBe('org-1');
    expect(values.instrumentId).toBe('inst-1');
    expect(values.optOutGlobalPool).toBe(false);
    expect(values.dependence).toBe('private');
    expect(values.studentCount).toBe(30);
    expect(values.bandDistribution).toEqual({
      insufficient: 5,
      elementary: 10,
      adequate: 10,
      advanced: 5,
    });
    expect(values.perSkill).toEqual([
      { nodeId: 'node-1', nodeName: 'Comprensión', achievement: 55, studentCount: 30 },
    ]);
    // No debe filtrarse ninguna clave de PII.
    expect(Object.keys(values)).not.toContain('studentId');
    expect(Object.keys(values)).not.toContain('studentName');
  });

  it('snapshotea optOutGlobalPool=true de org_benchmark_settings', async () => {
    const db = makeDb([
      [{ id: 'org-1', parentId: null, dependence: null, region: null, commune: null }],
      [{ optOut: true }], // readOptOut
      [
        {
          instrumentId: 'inst-1',
          gradeId: null,
          subjectId: null,
          studentCount: 10,
          avgAchievement: '50.00',
          insufficient: 0,
          elementary: 0,
          adequate: 0,
          advanced: 0,
        },
      ],
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
      [
        {
          instrumentId: 'inst-1',
          gradeId: null,
          subjectId: null,
          studentCount: 10,
          avgAchievement: '50.00',
          insufficient: 0,
          elementary: 0,
          adequate: 0,
          advanced: 0,
        },
      ],
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
      [
        {
          instrumentId: 'inst-1',
          gradeId: null,
          subjectId: null,
          studentCount: 10,
          avgAchievement: '50.00',
          insufficient: 0,
          elementary: 0,
          adequate: 0,
          advanced: 0,
        },
      ],
      [],
      // org-2 — sin datos en base (no se consulta perSkill)
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
