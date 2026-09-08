import type { Database } from '@soe/db';
import type { PerformanceBandInput } from '@soe/types';
import { ComparableUnitAssembler } from './comparable-unit.assembler';

type QueryBuilder = {
  from: (..._: unknown[]) => QueryBuilder;
  where: (..._: unknown[]) => QueryBuilder;
  innerJoin: (..._: unknown[]) => QueryBuilder;
  leftJoin: (..._: unknown[]) => QueryBuilder;
  groupBy: (..._: unknown[]) => QueryBuilder;
  orderBy: (..._: unknown[]) => QueryBuilder;
  as: (..._: unknown[]) => QueryBuilder;
  then: <T>(resolve: (rows: T[]) => unknown) => Promise<unknown>;
};

function makeDb(selectResults: unknown[][]): Database {
  let selectIdx = 0;

  function buildSelectChain(rows: unknown[]): QueryBuilder {
    const chain: QueryBuilder = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      groupBy: () => chain,
      orderBy: () => chain,
      as: () => chain,
      then: (resolve) => Promise.resolve(rows as never).then(resolve as never),
    };
    return chain;
  }

  const consume = () => {
    const rows = selectResults[selectIdx] ?? [];
    selectIdx++;
    return buildSelectChain(rows);
  };

  return {
    select: consume,
    selectDistinct: consume,
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(null),
  } as unknown as Database;
}

const BANDS: PerformanceBandInput[] = [
  { id: 'band-low', key: 'insufficient', label: 'Insuficiente', order: 1, minScore: 0 },
  { id: 'band-high', key: 'adequate', label: 'Adecuado', order: 2, minScore: 0.6 },
] as unknown as PerformanceBandInput[];

function makeDbAfterAssessmentYearSubquery(rows: unknown[]): Database {
  return makeDb([[], rows]);
}

function resultRow(overrides: Record<string, unknown> = {}) {
  return {
    classGroupId: 'cg-1',
    classGroupName: 'A',
    gradeName: '4° Medio',
    percentage: '50',
    performanceBandId: 'band-low',
    studentId: 'st-1',
    ...overrides,
  };
}

describe('ComparableUnitAssembler.loadByClassGroup', () => {
  const assembler = new ComparableUnitAssembler();

  it('cuenta cada alumno una sola vez por curso', async () => {
    const db = makeDbAfterAssessmentYearSubquery([
      resultRow({ studentId: 'st-1', percentage: '40' }),
      resultRow({ studentId: 'st-2', percentage: '60' }),
    ]);

    const [course] = await assembler.loadByClassGroup(db, 'org-1', ['a-1'], null, BANDS);

    expect(course.studentsAssessed).toBe(2);
    expect(course.averageAchievement).toBe(50);
  });

  it('promedia sobre todas las filas del alumno cuando rindió varias evaluaciones de la unidad', async () => {
    const db = makeDbAfterAssessmentYearSubquery([
      resultRow({ studentId: 'st-1', percentage: '40' }),
      resultRow({ studentId: 'st-1', percentage: '80' }),
    ]);

    const [course] = await assembler.loadByClassGroup(db, 'org-1', ['a-1', 'a-2'], null, BANDS);

    expect(course.studentsAssessed).toBe(1);
    expect(course.averageAchievement).toBe(60);
  });

  it('calcula el share de la banda inferior sobre las filas clasificadas', async () => {
    const db = makeDbAfterAssessmentYearSubquery([
      resultRow({ studentId: 'st-1', performanceBandId: 'band-low' }),
      resultRow({ studentId: 'st-2', performanceBandId: 'band-high' }),
      resultRow({ studentId: 'st-3', performanceBandId: 'band-low' }),
      resultRow({ studentId: 'st-4', performanceBandId: 'band-high' }),
    ]);

    const [course] = await assembler.loadByClassGroup(db, 'org-1', ['a-1'], null, BANDS);

    expect(course.lowestBandShare).toBe(50);
  });

  it('ordena los cursos por logro ascendente', async () => {
    const db = makeDbAfterAssessmentYearSubquery([
      resultRow({ classGroupId: 'cg-1', classGroupName: 'A', percentage: '80' }),
      resultRow({ classGroupId: 'cg-2', classGroupName: 'B', percentage: '30' }),
    ]);

    const courses = await assembler.loadByClassGroup(db, 'org-1', ['a-1'], null, BANDS);

    expect(courses.map((course) => course.classGroupName)).toEqual(['B', 'A']);
  });

  it('no consulta cuando el alcance de cursos quedó vacío', async () => {
    const db = makeDbAfterAssessmentYearSubquery([resultRow()]);

    const courses = await assembler.loadByClassGroup(db, 'org-1', ['a-1'], [], BANDS);

    expect(courses).toEqual([]);
  });
});
