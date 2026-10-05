import {
  countExpectedCells,
  expandExpectedCells,
  expectedCellKey,
  isExpectedScopeDefined,
} from './expected-scope';

const CURSO_A = '11111111-1111-1111-1111-111111111111';
const CURSO_B = '22222222-2222-2222-2222-222222222222';
const LENGUAJE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MATEMATICA = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('isExpectedScopeDefined', () => {
  it('exige cursos Y asignaturas: con una sola dimensión no hay denominador', () => {
    expect(isExpectedScopeDefined({ classGroupIds: [CURSO_A] })).toBe(false);
    expect(isExpectedScopeDefined({ subjectIds: [LENGUAJE] })).toBe(false);
    expect(isExpectedScopeDefined({ classGroupIds: [CURSO_A], subjectIds: [LENGUAJE] })).toBe(true);
  });

  it('trata el scope vacío, nulo e indefinido como no definido', () => {
    expect(isExpectedScopeDefined({})).toBe(false);
    expect(isExpectedScopeDefined(null)).toBe(false);
    expect(isExpectedScopeDefined(undefined)).toBe(false);
  });
});

describe('expandExpectedCells', () => {
  it('produce el producto cartesiano de cursos por asignaturas', () => {
    const cells = expandExpectedCells({
      classGroupIds: [CURSO_A, CURSO_B],
      subjectIds: [LENGUAJE, MATEMATICA],
    });

    expect(cells).toHaveLength(4);
    expect(cells.map(expectedCellKey)).toEqual([
      `${CURSO_A}:${LENGUAJE}`,
      `${CURSO_A}:${MATEMATICA}`,
      `${CURSO_B}:${LENGUAJE}`,
      `${CURSO_B}:${MATEMATICA}`,
    ]);
  });

  it('descuenta las celdas excluidas', () => {
    const cells = expandExpectedCells({
      classGroupIds: [CURSO_A, CURSO_B],
      subjectIds: [LENGUAJE, MATEMATICA],
      excludedCells: [{ classGroupId: CURSO_B, subjectId: MATEMATICA }],
    });

    expect(cells).toHaveLength(3);
    expect(cells.map(expectedCellKey)).not.toContain(`${CURSO_B}:${MATEMATICA}`);
  });

  it('ignora una exclusión que no pertenece al producto', () => {
    const cells = expandExpectedCells({
      classGroupIds: [CURSO_A],
      subjectIds: [LENGUAJE],
      excludedCells: [{ classGroupId: CURSO_B, subjectId: MATEMATICA }],
    });

    expect(cells).toHaveLength(1);
  });

  it('deduplica cursos y asignaturas repetidos en vez de multiplicar celdas', () => {
    const cells = expandExpectedCells({
      classGroupIds: [CURSO_A, CURSO_A],
      subjectIds: [LENGUAJE, LENGUAJE],
    });

    expect(cells).toEqual([{ classGroupId: CURSO_A, subjectId: LENGUAJE }]);
  });

  it('devuelve vacío cuando el scope no está definido', () => {
    expect(expandExpectedCells({ classGroupIds: [CURSO_A] })).toEqual([]);
    expect(expandExpectedCells(null)).toEqual([]);
  });

  it('no devuelve celdas cuando las exclusiones cubren todo el producto', () => {
    expect(
      countExpectedCells({
        classGroupIds: [CURSO_A],
        subjectIds: [LENGUAJE],
        excludedCells: [{ classGroupId: CURSO_A, subjectId: LENGUAJE }],
      }),
    ).toBe(0);
  });
});
