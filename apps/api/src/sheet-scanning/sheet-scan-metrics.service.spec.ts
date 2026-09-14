import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from '@soe/db';
import { SheetScanMetricsService } from './sheet-scan-metrics.service';

const ORG_ID = 'org-1';

type QueryChain = {
  from: (..._: unknown[]) => QueryChain;
  innerJoin: (..._: unknown[]) => QueryChain;
  where: (..._: unknown[]) => QueryChain;
  groupBy: (..._: unknown[]) => QueryChain;
  then: <T>(resolve: (rows: unknown[]) => T, reject?: (err: unknown) => unknown) => Promise<T>;
};

function makeDb(selectResults: unknown[][]): { db: Database; selectWheres: unknown[] } {
  let selectIdx = 0;
  const selectWheres: unknown[] = [];

  function chain(rows: unknown[]): QueryChain {
    const c: QueryChain = {
      from: () => c,
      innerJoin: () => c,
      where: (condition?: unknown) => {
        selectWheres.push(condition);
        return c;
      },
      groupBy: () => c,
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) as never,
    };
    return c;
  }

  const db = {
    select: () => chain(selectResults[selectIdx++] ?? []),
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db: db as unknown as Database, selectWheres };
}

function makeService(selectResults: unknown[][]): SheetScanMetricsService {
  return new SheetScanMetricsService(makeDb(selectResults).db);
}

describe('SheetScanMetricsService', () => {
  it('agrega lotes por estado, páginas rechazadas por motivo y marcas por estado', async () => {
    const service = makeService([
      [
        { key: 'confirmed', count: 4 },
        { key: 'needs_review', count: 2 },
      ],
      [
        { key: 'blurry', count: 3 },
        { key: 'fiducials_missing', count: 1 },
      ],
      [
        { key: 'marked', count: 90 },
        { key: 'blank', count: 6 },
        { key: 'ambiguous', count: 4 },
      ],
      [{ count: 2 }],
    ]);

    const metrics = await service.getMetrics(ORG_ID);

    expect(metrics.batchesByStatus).toEqual({
      pending: 0,
      processing: 0,
      needs_review: 2,
      confirmed: 4,
      failed: 0,
      rejected: 0,
    });
    expect(metrics.rejectedPagesByReason).toEqual({
      blurry: 3,
      glare: 0,
      fiducials_missing: 1,
      cropped: 0,
      no_separable_marks: 0,
    });
    expect(metrics.marksByState).toEqual({ marked: 90, blank: 6, multiple: 0, ambiguous: 4 });
  });

  it('calcula el % a revisión como (ambiguous + multiple) / total de marcas', async () => {
    const service = makeService([
      [],
      [],
      [
        { key: 'marked', count: 70 },
        { key: 'blank', count: 10 },
        { key: 'multiple', count: 12 },
        { key: 'ambiguous', count: 8 },
      ],
      [{ count: 0 }],
    ]);

    const metrics = await service.getMetrics(ORG_ID);

    expect(metrics.reviewRatePercent).toBe(20);
  });

  it('sin marcas el % a revisión es 0, sin división por cero', async () => {
    const service = makeService([[], [], [], []]);

    const metrics = await service.getMetrics(ORG_ID);

    expect(metrics.reviewRatePercent).toBe(0);
    expect(metrics.firmReadingOverrides).toBe(0);
    expect(metrics.registration).toEqual({
      pagesWithDiagnostics: 0,
      offMedianPxAvg: null,
      offMaxPxMax: null,
      fallbackPages: 0,
      offsetAlertPages: 0,
      fallbackAlertPages: 0,
      alerts: { offMedianPx: 10, fallbackRatio: 0.1 },
    });
  });

  it('agrega el registro local de burbujas desde sheet_scans.diagnostics', async () => {
    const service = makeService([
      [],
      [],
      [],
      [],
      [],
      [
        {
          pages: 9,
          offMedianPxAvg: '8.4444',
          offMaxPxMax: '17.69',
          fallbackPages: 1,
          offsetAlertPages: 3,
          fallbackAlertPages: 0,
        },
      ],
    ]);

    const metrics = await service.getMetrics(ORG_ID);

    expect(metrics.registration).toEqual({
      pagesWithDiagnostics: 9,
      offMedianPxAvg: 8.4,
      offMaxPxMax: 17.7,
      fallbackPages: 1,
      offsetAlertPages: 3,
      fallbackAlertPages: 0,
      alerts: { offMedianPx: 10, fallbackRatio: 0.1 },
    });
  });

  it('B1: mide cuántas sugerencias del motor confirmó o rechazó el revisor', async () => {
    const service = makeService([
      [],
      [],
      [],
      [{ count: 0 }],
      [{ count: 0 }],
      [],
      [{ marksWithSuggestion: 12, reviewed: 9, confirmed: 7 }],
    ]);

    const metrics = await service.getMetrics(ORG_ID);

    expect(metrics.suggestions).toEqual({
      marksWithSuggestion: 12,
      reviewed: 9,
      confirmed: 7,
      rejected: 2,
    });
  });

  it('sin marcas con sugerencia las métricas de B1 quedan en cero', async () => {
    const service = makeService([[], [], [], [{ count: 0 }], [{ count: 0 }], []]);

    const metrics = await service.getMetrics(ORG_ID);

    expect(metrics.suggestions).toEqual({
      marksWithSuggestion: 0,
      reviewed: 0,
      confirmed: 0,
      rejected: 0,
    });
  });

  it('expone las correcciones humanas que contradicen lecturas firmes', async () => {
    const service = makeService([[], [], [{ key: 'marked', count: 10 }], [{ count: 3 }]]);

    const metrics = await service.getMetrics(ORG_ID);

    expect(metrics.firmReadingOverrides).toBe(3);
  });

  it('un rejectReason nulo se agrupa bajo unknown en vez de perderse', async () => {
    const service = makeService([[], [{ key: null, count: 2 }], [], [{ count: 0 }]]);

    const metrics = await service.getMetrics(ORG_ID);

    expect(metrics.rejectedPagesByReason.unknown).toBe(2);
  });

  it('CD-9: las marcas fijas de crop_region no inflan el denominador del % a revisión', async () => {
    const service = makeService([
      [],
      [],
      [
        { key: 'marked', count: 70 },
        { key: 'blank', count: 10 },
        { key: 'multiple', count: 12 },
        { key: 'ambiguous', count: 8 },
      ],
      [{ count: 0 }],
      [{ count: 50 }],
    ]);

    const metrics = await service.getMetrics(ORG_ID);

    expect(metrics.reviewRatePercent).toBe(40);
    expect(metrics.marksByState.marked).toBe(70);
  });

  it('las marcas de scans superseded quedan fuera de todas las queries de marcas y de diagnóstico', async () => {
    const { db, selectWheres } = makeDb([[], [], [], [{ count: 0 }], [{ count: 0 }], []]);
    const service = new SheetScanMetricsService(db);

    await service.getMetrics(ORG_ID);

    const dialect = new PgDialect();
    const markQueries = selectWheres.slice(2).map((condition) => {
      return dialect.sqlToQuery(condition as Parameters<PgDialect['sqlToQuery']>[0]);
    });
    expect(markQueries).toHaveLength(5);
    for (const query of markQueries) {
      expect(query.sql).toContain('"sheet_scans"."state" <>');
      expect(query.params).toContain('superseded');
    }
  });
});
