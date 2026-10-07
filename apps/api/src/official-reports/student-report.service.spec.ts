import type { Database } from '@soe/db';
import { StudentReportService } from './student-report.service';
import type { ReportSupportService } from './report-support.service';

type QueryBuilder = {
  from: (..._: unknown[]) => QueryBuilder;
  innerJoin: (..._: unknown[]) => QueryBuilder;
  where: (..._: unknown[]) => QueryBuilder;
  then: <T>(resolve: (rows: T[]) => unknown) => Promise<unknown>;
};

function makeDb(rows: unknown[]): { db: Database; selects: () => number } {
  let selects = 0;
  const chain: QueryBuilder = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    then: (resolve) => Promise.resolve(rows as never).then(resolve as never),
  };
  const db = {
    select: () => {
      selects++;
      return chain;
    },
  } as unknown as Database;
  return { db, selects: () => selects };
}

type LoadClassAverage = (
  tx: Database,
  assessmentId: string,
  orgId: string,
  scopeClassGroupIds: string[] | null,
) => Promise<number | null>;

function loadClassAverage(db: Database, scope: string[] | null): Promise<number | null> {
  const svc = new StudentReportService(db, {} as ReportSupportService);
  return (svc as unknown as { loadClassAverage: LoadClassAverage }).loadClassAverage(
    db,
    'assessment-1',
    'org-1',
    scope,
  );
}

describe('StudentReportService.loadClassAverage', () => {
  it('el promedio del curso es Σ puntaje ÷ Σ máximo de sus alumnos (33/60 = 55)', async () => {
    const { db } = makeDb([{ scoreSum: '33.00', maxSum: '60.00' }]);
    expect(await loadClassAverage(db, null)).toBeCloseTo(55);
  });

  it('acotado al scope del profesor usa el mismo Σ/Σ (18/24 = 75)', async () => {
    const { db } = makeDb([{ scoreSum: '18.00', maxSum: '24.00' }]);
    expect(await loadClassAverage(db, ['cg-1'])).toBeCloseTo(75);
  });

  it('sin puntaje corregido en el curso (Σ máximo 0) devuelve null, no 0', async () => {
    const { db } = makeDb([{ scoreSum: '0', maxSum: '0' }]);
    expect(await loadClassAverage(db, null)).toBeNull();
  });

  it('con un scope vacío devuelve null sin consultar', async () => {
    const { db, selects } = makeDb([{ scoreSum: '10', maxSum: '10' }]);
    expect(await loadClassAverage(db, [])).toBeNull();
    expect(selects()).toBe(0);
  });
});
