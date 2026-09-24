import {
  assembleCoverage,
  resolveCellStatus,
  type CoverageCatalog,
} from './measurement-processes.helpers';

const CURSO_A = '11111111-1111-1111-1111-111111111111';
const CURSO_B = '22222222-2222-2222-2222-222222222222';
const LENGUAJE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MATEMATICA = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function catalog(overrides: Partial<CoverageCatalog> = {}): CoverageCatalog {
  return {
    classGroups: new Map([
      [CURSO_A, { name: '5°A', gradeShortName: '5°', gradeOrder: 5 }],
      [CURSO_B, { name: '6°A', gradeShortName: '6°', gradeOrder: 6 }],
    ]),
    subjects: new Map([
      [LENGUAJE, { name: 'Lenguaje', shortName: 'LEN' }],
      [MATEMATICA, { name: 'Matemática', shortName: 'MAT' }],
    ]),
    studentsByClassGroup: new Map([
      [CURSO_A, 30],
      [CURSO_B, 28],
    ]),
    ...overrides,
  };
}

function actualCell(overrides: Partial<Parameters<typeof assembleCoverage>[1][number]> = {}) {
  return {
    assessmentId: 'assessment-1',
    assessmentName: 'Lenguaje 5°A',
    classGroupId: CURSO_A,
    classGroupName: '5°A',
    gradeShortName: '5°',
    gradeOrder: 5,
    subjectId: LENGUAJE,
    subjectName: 'Lenguaje',
    subjectShortName: 'LEN',
    studentsWithResults: 30,
    ...overrides,
  };
}

describe('resolveCellStatus', () => {
  it('sin evaluación es missing, aunque haya matrícula', () => {
    expect(resolveCellStatus(false, 0, 30)).toBe('missing');
  });

  it('con evaluación y cero resultados es scheduled', () => {
    expect(resolveCellStatus(true, 0, 30)).toBe('scheduled');
  });

  it('con menos resultados que matrícula es partial', () => {
    expect(resolveCellStatus(true, 22, 30)).toBe('partial');
  });

  it('es complete cuando alcanza o supera la matrícula', () => {
    expect(resolveCellStatus(true, 30, 30)).toBe('complete');
    expect(resolveCellStatus(true, 31, 30)).toBe('complete');
  });

  it('sin matrícula conocida no puede juzgar carga incompleta', () => {
    expect(resolveCellStatus(true, 5, 0)).toBe('complete');
  });
});

describe('assembleCoverage', () => {
  it('cuenta como missing la celda esperada que no tiene evaluación', () => {
    const { totals, cells } = assembleCoverage(
      { classGroupIds: [CURSO_A, CURSO_B], subjectIds: [LENGUAJE] },
      [actualCell()],
      catalog(),
    );

    expect(totals).toEqual({ expected: 2, missing: 1, scheduled: 0, partial: 0, complete: 1 });
    expect(cells.find((c) => c.classGroupId === CURSO_B)?.status).toBe('missing');
  });

  it('nombra la celda faltante desde el catálogo, no desde la evaluación inexistente', () => {
    const { cells } = assembleCoverage(
      { classGroupIds: [CURSO_B], subjectIds: [MATEMATICA] },
      [],
      catalog(),
    );

    expect(cells[0]).toMatchObject({
      classGroupName: '6°A',
      subjectName: 'Matemática',
      assessmentId: null,
      status: 'missing',
    });
  });

  it('descuenta las celdas excluidas del denominador', () => {
    const { totals } = assembleCoverage(
      {
        classGroupIds: [CURSO_A, CURSO_B],
        subjectIds: [LENGUAJE, MATEMATICA],
        excludedCells: [{ classGroupId: CURSO_B, subjectId: MATEMATICA }],
      },
      [],
      catalog(),
    );

    expect(totals.expected).toBe(3);
    expect(totals.missing).toBe(3);
  });

  it('reporta como inesperada la evaluación que cae fuera del alcance declarado', () => {
    const { cells, unexpectedCells } = assembleCoverage(
      { classGroupIds: [CURSO_A], subjectIds: [LENGUAJE] },
      [actualCell(), actualCell({ classGroupId: CURSO_B, classGroupName: '6°A', gradeOrder: 6 })],
      catalog(),
    );

    expect(cells).toHaveLength(1);
    expect(unexpectedCells).toHaveLength(1);
    expect(unexpectedCells[0].classGroupId).toBe(CURSO_B);
  });

  it('suma los resultados de dos evaluaciones que caen en la misma celda', () => {
    const { cells } = assembleCoverage(
      { classGroupIds: [CURSO_A], subjectIds: [LENGUAJE] },
      [
        actualCell({ assessmentId: 'a-1', studentsWithResults: 12 }),
        actualCell({ assessmentId: 'a-2', studentsWithResults: 18 }),
      ],
      catalog(),
    );

    expect(cells[0].studentsWithResults).toBe(30);
    expect(cells[0].status).toBe('complete');
  });

  it('sin alcance declarado no inventa denominador: expected en 0 y todo va a inesperadas', () => {
    const { totals, cells, unexpectedCells } = assembleCoverage({}, [actualCell()], catalog());

    expect(totals.expected).toBe(0);
    expect(cells).toHaveLength(0);
    expect(unexpectedCells).toHaveLength(1);
  });

  it('ordena por nivel y luego por curso y asignatura', () => {
    const { cells } = assembleCoverage(
      { classGroupIds: [CURSO_B, CURSO_A], subjectIds: [MATEMATICA, LENGUAJE] },
      [],
      catalog(),
    );

    expect(cells.map((c) => `${c.classGroupName}/${c.subjectName}`)).toEqual([
      '5°A/Lenguaje',
      '5°A/Matemática',
      '6°A/Lenguaje',
      '6°A/Matemática',
    ]);
  });
});
