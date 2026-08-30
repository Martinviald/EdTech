import type { Database } from '@soe/db';
import { SheetScanMetricsService } from './sheet-scan-metrics.service';

const ORG_ID = 'org-1';

type QueryChain = {
  from: (..._: unknown[]) => QueryChain;
  where: (..._: unknown[]) => QueryChain;
  groupBy: (..._: unknown[]) => QueryChain;
  then: <T>(resolve: (rows: unknown[]) => T, reject?: (err: unknown) => unknown) => Promise<T>;
};

function makeDb(selectResults: unknown[][]): Database {
  let selectIdx = 0;

  function chain(rows: unknown[]): QueryChain {
    const c: QueryChain = {
      from: () => c,
      where: () => c,
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
  return db as unknown as Database;
}

function makeService(selectResults: unknown[][]): SheetScanMetricsService {
  return new SheetScanMetricsService(makeDb(selectResults));
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
});
