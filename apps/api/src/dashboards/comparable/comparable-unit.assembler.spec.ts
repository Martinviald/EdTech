import type { Database } from '@soe/db';
import type { PerformanceBandInput } from '@soe/types';
import { ComparableUnitAssembler, type ClassGroupBreakdownData } from './comparable-unit.assembler';

const BANDS: PerformanceBandInput[] = [
  {
    id: 'band-low',
    key: 'insufficient',
    label: 'Insuficiente',
    order: 1,
    minThreshold: 0,
    maxThreshold: 0.6,
    color: null,
  },
  {
    id: 'band-high',
    key: 'adequate',
    label: 'Adecuado',
    order: 2,
    minThreshold: 0.6,
    maxThreshold: 1,
    color: null,
  },
];

function breakdown(overrides: Partial<ClassGroupBreakdownData> = {}): ClassGroupBreakdownData {
  return { totals: [], classification: [], ...overrides };
}

function totalsRow(
  overrides: Partial<ClassGroupBreakdownData['totals'][number]> = {},
): ClassGroupBreakdownData['totals'][number] {
  return {
    instrumentId: 'i-1',
    classGroupId: 'cg-1',
    classGroupName: 'A',
    gradeName: '4° Medio',
    studentsAssessed: 1,
    percentageSum: '50',
    percentageCount: 1,
    ...overrides,
  };
}

describe('ComparableUnitAssembler.foldByClassGroup', () => {
  const assembler = new ComparableUnitAssembler();

  it('promedia con la suma y el conteo que agregó Postgres', () => {
    const [course] = assembler.foldByClassGroup(
      breakdown({
        totals: [totalsRow({ studentsAssessed: 2, percentageSum: '100', percentageCount: 2 })],
      }),
      BANDS,
    );

    expect(course.studentsAssessed).toBe(2);
    expect(course.averageAchievement).toBe(50);
  });

  it('deja el logro en null cuando ninguna fila tenía porcentaje', () => {
    const [course] = assembler.foldByClassGroup(
      breakdown({ totals: [totalsRow({ percentageSum: null, percentageCount: 0 })] }),
      BANDS,
    );

    expect(course.averageAchievement).toBeNull();
    expect(course.lowestBandShare).toBeNull();
  });

  it('suma los conteos de banda que ya clasificó la base', () => {
    const [course] = assembler.foldByClassGroup(
      breakdown({
        totals: [totalsRow({ studentsAssessed: 4, percentageSum: '200', percentageCount: 4 })],
        classification: [
          {
            instrumentId: 'i-1',
            classGroupId: 'cg-1',
            performanceBandId: 'band-low',
            percentage: null,
            count: 2,
          },
          {
            instrumentId: 'i-1',
            classGroupId: 'cg-1',
            performanceBandId: 'band-high',
            percentage: null,
            count: 2,
          },
        ],
      }),
      BANDS,
    );

    expect(course.lowestBandShare).toBe(50);
  });

  it('clasifica con las bandas del instrumento las filas que no traen banda', () => {
    const [course] = assembler.foldByClassGroup(
      breakdown({
        totals: [totalsRow({ studentsAssessed: 2, percentageSum: '110', percentageCount: 2 })],
        classification: [
          {
            instrumentId: 'i-1',
            classGroupId: 'cg-1',
            performanceBandId: null,
            percentage: '30',
            count: 1,
          },
          {
            instrumentId: 'i-1',
            classGroupId: 'cg-1',
            performanceBandId: null,
            percentage: '80',
            count: 1,
          },
        ],
      }),
      BANDS,
    );

    expect(course.lowestBandShare).toBe(50);
  });

  it('mezcla los dos orígenes de clasificación en el mismo curso', () => {
    const [course] = assembler.foldByClassGroup(
      breakdown({
        totals: [totalsRow({ studentsAssessed: 3, percentageSum: '150', percentageCount: 3 })],
        classification: [
          {
            instrumentId: 'i-1',
            classGroupId: 'cg-1',
            performanceBandId: 'band-high',
            percentage: null,
            count: 1,
          },
          {
            instrumentId: 'i-1',
            classGroupId: 'cg-1',
            performanceBandId: null,
            percentage: '30',
            count: 2,
          },
        ],
      }),
      BANDS,
    );

    expect(course.lowestBandShare).toBeCloseTo(66.6666, 3);
  });

  it('ordena los cursos por logro ascendente', () => {
    const courses = assembler.foldByClassGroup(
      breakdown({
        totals: [
          totalsRow({ classGroupId: 'cg-1', classGroupName: 'A', percentageSum: '80' }),
          totalsRow({ classGroupId: 'cg-2', classGroupName: 'B', percentageSum: '30' }),
        ],
      }),
      BANDS,
    );

    expect(courses.map((course) => course.classGroupName)).toEqual(['B', 'A']);
  });
});

describe('ComparableUnitAssembler.loadClassGroupBreakdown', () => {
  const assembler = new ComparableUnitAssembler();
  const unusedDb = {} as Database;

  it('no consulta cuando el alcance no tiene evaluaciones', async () => {
    await expect(assembler.loadClassGroupBreakdown(unusedDb, 'org-1', [], null)).resolves.toEqual(
      breakdown(),
    );
  });

  it('no consulta cuando el alcance de cursos quedó vacío', async () => {
    await expect(
      assembler.loadClassGroupBreakdown(unusedDb, 'org-1', ['a-1'], []),
    ).resolves.toEqual(breakdown());
  });
});
