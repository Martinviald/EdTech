import {
  achievementPct,
  addTally,
  emptyTally,
  tallyOf,
  type AchievementTally,
} from './achievement';

describe('achievementPct', () => {
  it('es Σ puntaje ÷ Σ máximo en escala 0..100', () => {
    expect(achievementPct({ scoreSum: 30, maxSum: 40 })).toBe(75);
  });

  it('no redondea', () => {
    expect(achievementPct({ scoreSum: 1, maxSum: 3 })).toBeCloseTo(33.3333333, 6);
  });

  it('es null sin puntaje corregido, no 0', () => {
    expect(achievementPct(emptyTally())).toBeNull();
    expect(achievementPct({ scoreSum: 0, maxSum: 0 })).toBeNull();
    expect(achievementPct({ scoreSum: 0, maxSum: -1 })).toBeNull();
  });

  it('es 0 cuando hay puntaje corregido y el grupo no obtuvo nada', () => {
    expect(achievementPct({ scoreSum: 0, maxSum: 12 })).toBe(0);
  });

  it('pondera por puntaje: una pregunta de desarrollo de 2 puntos pesa el doble', () => {
    const multipleChoice = { scoreSum: 1, maxSum: 1 };
    const development = { scoreSum: 0, maxSum: 2 };
    const tally = emptyTally();
    addTally(tally, multipleChoice);
    addTally(tally, development);
    expect(achievementPct(tally)).toBeCloseTo(33.333333, 5);
  });

  it('cuenta el crédito parcial', () => {
    expect(
      achievementPct(
        tallyOf([
          { scoreSum: 0.5, maxSum: 1 },
          { scoreSum: 1, maxSum: 1 },
        ]),
      ),
    ).toBe(75);
  });
});

describe('addTally', () => {
  it('suma en el destino sin tocar la fuente', () => {
    const target: AchievementTally = { scoreSum: 3, maxSum: 4 };
    const source: AchievementTally = { scoreSum: 2, maxSum: 6 };
    addTally(target, source);
    expect(target).toEqual({ scoreSum: 5, maxSum: 10 });
    expect(source).toEqual({ scoreSum: 2, maxSum: 6 });
  });

  it('combinar cursos suma conteos, no promedia porcentajes', () => {
    const courseA = { scoreSum: 9, maxSum: 10 };
    const courseB = { scoreSum: 30, maxSum: 100 };
    const level = emptyTally();
    addTally(level, courseA);
    addTally(level, courseB);
    expect(achievementPct(level)).toBeCloseTo(35.454545, 5);
  });
});

describe('tallyOf', () => {
  it('acepta los decimal de Postgres como string', () => {
    expect(tallyOf([{ scoreSum: '12.50', maxSum: '20.00' }])).toEqual({
      scoreSum: 12.5,
      maxSum: 20,
    });
  });

  it('cuenta 0 los null y los valores no numéricos', () => {
    expect(
      tallyOf([
        { scoreSum: null, maxSum: '4' },
        { scoreSum: 'abc', maxSum: null },
        { scoreSum: 3, maxSum: Number.NaN },
      ]),
    ).toEqual({ scoreSum: 3, maxSum: 4 });
  });

  it('es vacío sin filas', () => {
    expect(tallyOf([])).toEqual(emptyTally());
  });
});
