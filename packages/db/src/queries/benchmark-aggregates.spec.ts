import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from '../client';
import { assessmentItemStats, assessmentSkillStats } from '../schema/results';
import { preferComputedOverImported, refreshBenchmarkAggregates } from './benchmark-aggregates';

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
//     e. buildOrgRows.perSkill (tallies de assessment_skill_stats por nodo)
//     f. buildOrgRows.tally del colegio por instrumento (assessment_item_stats)
//
// `db.insert().values().onConflictDoUpdate()` registra el upsert.
// `db.delete().where()` registra la poda de la corrida anterior.
// withOrgContext usa db.transaction → marca __transactionRan.
// ──────────────────────────────────────────────────────────────────────────────

type DbMock = Database & {
  __upserts: Array<{ values: unknown }>;
  __deletes: number;
  __transactionRan: boolean;
};

function makeDb(selectResults: unknown[][]): DbMock {
  let idx = 0;
  const upserts: Array<{ values: unknown }> = [];
  let deletes = 0;

  function buildSelect(rows: unknown[]): unknown {
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'groupBy', 'orderBy', 'limit']) {
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
      values: (values: unknown) => ({
        onConflictDoUpdate: () => {
          upserts.push({ values });
          return Promise.resolve([]);
        },
      }),
    }),
    delete: () => ({
      where: () => {
        deletes++;
        return Promise.resolve([]);
      },
    }),
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      db.__transactionRan = true;
      return fn(db);
    },
    __upserts: upserts,
    get __deletes() {
      return deletes;
    },
    __transactionRan: false,
  } as unknown as DbMock;

  return db;
}

function resultRow(
  overrides: Partial<{
    instrumentId: string;
    gradeId: string | null;
    subjectId: string | null;
    studentId: string;
    percentage: string | null;
    performanceBandId: string | null;
  }> = {},
) {
  return {
    instrumentId: 'inst-1',
    gradeId: 'g1',
    subjectId: 's1',
    studentId: 'stu-1',
    percentage: '62.50',
    performanceBandId: null,
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

describe('refreshBenchmarkAggregates', () => {
  it('poda la corrida anterior de la org, aunque el instrumento no tenga grado ni asignatura', async () => {
    const db = makeDb([
      [{ id: 'org-1', parentId: null, dependence: 'private', region: 'RM', commune: 'Santiago' }],
      [{ optOut: false }],
      [resultRow({ gradeId: null, subjectId: null, percentage: '55.00' })],
      [familyRow('inst-1', 2026)],
      THREE_BANDS,
      [],
    ]);

    const res = await refreshBenchmarkAggregates(db);

    expect(res.refreshedRows).toBe(1);
    const values = db.__upserts[0]?.values as Record<string, unknown>;
    expect(values.gradeId).toBeNull();
    expect(values.subjectId).toBeNull();
    expect(db.__deletes).toBeGreaterThan(0);
  });

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
      // perSkill(org-1): 30 alumnos, 4 puntos cada uno en el nodo.
      [
        {
          instrumentId: 'inst-1',
          nodeId: 'node-1',
          nodeName: 'Comprensión',
          scoreSum: '66.00',
          maxSum: '120.00',
          studentCount: 30,
        },
      ],
      // tally(org-1): Σ puntaje ÷ Σ máximo de assessment_item_stats.
      [{ instrumentId: 'inst-1', scoreSum: '36.00', maxSum: '60.00' }],
    ]);
    const res = await refreshBenchmarkAggregates(db);

    expect(res.refreshedOrgs).toBe(1);
    expect(res.refreshedRows).toBe(1);
    expect(db.__transactionRan).toBe(true);
    expect(db.__upserts).toHaveLength(1);

    const values = db.__upserts[0]?.values as Record<string, unknown>;
    expect(values.orgId).toBe('org-1');
    expect(values.instrumentId).toBe('inst-1');
    expect(values.optOutGlobalPool).toBe(false);
    expect(values.dependence).toBe('private');
    // Alumnos distintos desde los resultados; el % del colegio es su tally, no el promedio
    // de los % por alumno (que daría 55 con 30 y 80).
    expect(values.studentCount).toBe(2);
    expect(values.scoreSum).toBe('36.00');
    expect(values.maxSum).toBe('60.00');
    expect(values.avgAchievement).toBe('60.00');
    expect(values.bandCounts).toEqual([
      { bandKey: 'nivel-1', label: 'nivel-1', order: 0, count: 1 },
      { bandKey: 'nivel-3', label: 'nivel-3', order: 2, count: 1 },
    ]);
    expect(Object.keys(values)).not.toContain('bandDistribution');
    expect(values.perSkill).toEqual([
      {
        nodeId: 'node-1',
        nodeName: 'Comprensión',
        achievement: 55,
        studentCount: 30,
        scoreSum: 66,
        maxSum: 120,
      },
    ]);
    expect(Object.keys(values)).not.toContain('studentId');
    expect(Object.keys(values)).not.toContain('studentName');
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
    await refreshBenchmarkAggregates(db);

    const values = db.__upserts[0]?.values as { bandCounts: unknown };
    expect(values.bandCounts).toEqual([
      { bandKey: 'nivel-1', label: 'nivel-1', order: 0, count: 1 },
      { bandKey: 'nivel-3', label: 'nivel-3', order: 2, count: 1 },
    ]);
  });

  it('las filas band-only sin banda persistida no suman al logro ni a band_counts', async () => {
    const db = makeDb([
      [{ id: 'org-1', parentId: null, dependence: null, region: null, commune: null }],
      [{ optOut: false }],
      [
        resultRow({ studentId: 'a', percentage: null }),
        resultRow({ studentId: 'b', percentage: null }),
      ],
      [familyRow('inst-1', 2026)],
      THREE_BANDS,
    ]);
    await refreshBenchmarkAggregates(db);

    const values = db.__upserts[0]?.values as {
      bandCounts: unknown;
      avgAchievement: string | null;
      studentCount: number;
    };
    expect(values.bandCounts).toEqual([]);
    expect(values.avgAchievement).toBeNull();
    expect(values.studentCount).toBe(2);
  });

  it('cuenta band_counts por la banda propia del instrumento, sin proyectar', async () => {
    const db = makeDb([
      [{ id: 'org-1', parentId: null, dependence: null, region: null, commune: null }],
      [{ optOut: false }],
      [
        resultRow({ studentId: 'a', percentage: '30.00' }),
        resultRow({ studentId: 'b', percentage: '55.00' }),
        resultRow({ studentId: 'c', percentage: '80.00' }),
        resultRow({ studentId: 'd', percentage: '100.00' }),
      ],
      [familyRow('inst-1', 2026)],
      THREE_BANDS,
      [],
    ]);
    await refreshBenchmarkAggregates(db);

    const values = db.__upserts[0]?.values as { bandCounts: unknown };
    expect(values.bandCounts).toEqual([
      { bandKey: 'nivel-1', label: 'nivel-1', order: 0, count: 1 },
      { bandKey: 'nivel-2', label: 'nivel-2', order: 1, count: 1 },
      { bandKey: 'nivel-3', label: 'nivel-3', order: 2, count: 2 },
    ]);
  });

  it('cuenta las filas band-only en band_counts por su banda persistida', async () => {
    const db = makeDb([
      [{ id: 'org-1', parentId: null, dependence: null, region: null, commune: null }],
      [{ optOut: false }],
      [
        resultRow({
          studentId: 'a',
          percentage: null,
          performanceBandId: 'band-inst-1-nivel-2',
        }),
        resultRow({ studentId: 'b', percentage: null }),
      ],
      [familyRow('inst-1', 2026)],
      THREE_BANDS,
    ]);
    await refreshBenchmarkAggregates(db);

    const values = db.__upserts[0]?.values as { bandCounts: unknown };
    expect(values.bandCounts).toEqual([
      { bandKey: 'nivel-2', label: 'nivel-2', order: 1, count: 1 },
    ]);
  });

  it('sin bandas efectivas deja band_counts vacío', async () => {
    const db = makeDb([
      [{ id: 'org-1', parentId: null, dependence: null, region: null, commune: null }],
      [{ optOut: false }],
      [resultRow({ studentId: 'a', percentage: '55.00' })],
      [familyRow('inst-1', 2026)],
      [],
      [familyRow('inst-1', 2026)],
      [],
      [],
    ]);
    await refreshBenchmarkAggregates(db);

    const values = db.__upserts[0]?.values as { bandCounts: unknown };
    expect(values.bandCounts).toEqual([]);
  });

  it('refresca aciertos por ítem con el snapshot del opt-out, aunque la org no tenga resultados', async () => {
    const db = makeDb([
      [{ id: 'org-1', parentId: null, dependence: null, region: null, commune: null }],
      [{ optOut: true }],
      [],
      [
        {
          instrumentId: 'inst-1',
          itemId: 'item-1',
          correctCount: 30,
          responseCount: 80,
          scoreSum: '30.00',
          maxSum: '80.00',
        },
        {
          instrumentId: 'inst-1',
          itemId: 'item-2',
          correctCount: '70',
          responseCount: '85',
          scoreSum: '77.50',
          maxSum: '85.00',
        },
      ],
    ]);

    const res = await refreshBenchmarkAggregates(db);

    expect(res).toEqual({ refreshedOrgs: 0, refreshedRows: 0, refreshedItemRows: 2 });
    expect(db.__upserts).toHaveLength(1);
    expect(db.__upserts[0]?.values).toEqual([
      expect.objectContaining({
        orgId: 'org-1',
        itemId: 'item-1',
        correctCount: 30,
        responseCount: 80,
        scoreSum: '30.00',
        maxSum: '80.00',
        optOutGlobalPool: true,
      }),
      expect.objectContaining({
        itemId: 'item-2',
        correctCount: 70,
        responseCount: 85,
        scoreSum: '77.50',
        maxSum: '85.00',
      }),
    ]);
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
    await refreshBenchmarkAggregates(db);

    const values = db.__upserts[0]?.values as { optOutGlobalPool: boolean };
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
    await refreshBenchmarkAggregates(db);

    const values = db.__upserts[0]?.values as { networkOrgId: string | null };
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
    const res = await refreshBenchmarkAggregates(db);

    expect(res.refreshedOrgs).toBe(1); // solo org-1 produjo filas
    expect(res.refreshedRows).toBe(1);
    expect(db.__upserts).toHaveLength(1);
  });
});

describe('preferComputedOverImported', () => {
  const render = (predicate: SQL): string => new PgDialect().sqlToQuery(predicate).sql;

  it('descarta la fila importada sólo cuando la misma celda tiene la calculada', () => {
    const query = render(preferComputedOverImported(assessmentSkillStats));

    expect(query).toContain("= 'imported'");
    expect(query).toContain("= 'computed'");
    expect(query).toContain('exists');
    expect(query).toContain('class_group_id');
    expect(query).toContain('node_id');
    expect(query).toContain('instrument_id');
  });

  it('usa item_id como dimensión para los agregados por ítem', () => {
    const query = render(preferComputedOverImported(assessmentItemStats));

    expect(query).toContain('item_id');
    expect(query).not.toContain('node_id');
  });
});
