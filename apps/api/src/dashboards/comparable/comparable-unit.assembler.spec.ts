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
    scoreSum: '5',
    maxSum: '10',
    ...overrides,
  };
}

describe('ComparableUnitAssembler.foldByClassGroup', () => {
  const assembler = new ComparableUnitAssembler();

  it('logro del curso = Σ puntaje ÷ Σ máximo que agregó Postgres (9/20 = 45)', () => {
    const [course] = assembler.foldByClassGroup(
      breakdown({
        totals: [totalsRow({ studentsAssessed: 2, scoreSum: '9', maxSum: '20' })],
      }),
      BANDS,
    );

    expect(course.studentsAssessed).toBe(2);
    expect(course.averageAchievement).toBe(45);
  });

  it('suma los tallies de varios instrumentos del mismo curso: (9 + 6) / (20 + 30) = 30, no el promedio 37,5 de 45 y 20', () => {
    const [course] = assembler.foldByClassGroup(
      breakdown({
        totals: [
          totalsRow({ instrumentId: 'i-1', studentsAssessed: 2, scoreSum: '9', maxSum: '20' }),
          totalsRow({ instrumentId: 'i-2', studentsAssessed: 3, scoreSum: '6', maxSum: '30' }),
        ],
      }),
      BANDS,
    );

    expect(course.studentsAssessed).toBe(5);
    expect(course.averageAchievement).toBe(30);
  });

  it('deja el logro en null cuando no hay puntaje corregido (maxSum 0)', () => {
    const [course] = assembler.foldByClassGroup(
      breakdown({ totals: [totalsRow({ scoreSum: '0', maxSum: '0' })] }),
      BANDS,
    );

    expect(course.averageAchievement).toBeNull();
    expect(course.lowestBandShare).toBeNull();
  });

  it('suma los conteos de banda que ya clasificó la base', () => {
    const [course] = assembler.foldByClassGroup(
      breakdown({
        totals: [totalsRow({ studentsAssessed: 4, scoreSum: '20', maxSum: '40' })],
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
        totals: [totalsRow({ studentsAssessed: 2, scoreSum: '11', maxSum: '20' })],
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
        totals: [totalsRow({ studentsAssessed: 3, scoreSum: '15', maxSum: '30' })],
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
          totalsRow({ classGroupId: 'cg-1', classGroupName: 'A', scoreSum: '8' }),
          totalsRow({ classGroupId: 'cg-2', classGroupName: 'B', scoreSum: '3' }),
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

describe('ComparableUnitAssembler baselines con línea de prueba', () => {
  const assembler = new ComparableUnitAssembler();

  function candidateRow(instrumentId: string, trackId: string | null, year: number) {
    return {
      assessmentId: `a-${instrumentId}`,
      instrumentId,
      instrumentName: instrumentId,
      type: 'paes',
      subjectId: 's-math',
      gradeId: 'g-iv',
      applicationPeriod: null,
      year,
      trackId,
    };
  }

  function dbReturning(rows: unknown[]): Database {
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => Promise.resolve(rows),
    };
    return { select: () => chain } as unknown as Database;
  }

  it('M2 toma como año anterior a M2, nunca a M1 del mismo grado', async () => {
    const db = dbReturning([
      candidateRow('m1-2025', 't-m1', 2025),
      candidateRow('m2-2025', 't-m2', 2025),
    ]);
    const ref = {
      instrumentId: 'm2-2026',
      type: 'paes',
      subjectId: 's-math',
      gradeId: 'g-iv',
      applicationPeriod: null,
      year: 2026,
      trackId: 't-m2',
    };

    const candidates = await assembler.loadBaselineCandidates(db, 'org-1', [ref]);
    const choices = assembler.resolveBaselineChoices(ref, candidates);

    expect(choices.previousYear?.instrumentId).toBe('m2-2025');
  });

  it('sin línea, el año anterior se resuelve igual que antes', async () => {
    const db = dbReturning([candidateRow('dia-2025', null, 2025)]);
    const ref = {
      instrumentId: 'dia-2026',
      type: 'paes',
      subjectId: 's-math',
      gradeId: 'g-iv',
      applicationPeriod: null,
      year: 2026,
      trackId: null,
    };

    const candidates = await assembler.loadBaselineCandidates(db, 'org-1', [ref]);

    expect(assembler.resolveBaselineChoices(ref, candidates).previousYear?.instrumentId).toBe(
      'dia-2025',
    );
  });
});
