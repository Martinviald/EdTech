import {
  correctKeysOf,
  hasMultipleCorrectAlternatives,
  parseSelectedKeys,
  sameKeySet,
} from './multi-select';

const KEYS = ['1', '2', '3', '4', '5'];

describe('parseSelectedKeys', () => {
  it('parte la forma concatenada cuando todas las keys son de un carácter', () => {
    expect(parseSelectedKeys('145', KEYS)).toEqual(new Set(['1', '4', '5']));
  });

  it('acepta separadores', () => {
    for (const raw of ['1,4,5', '1 4 5', '1;4;5', '1/4/5', '1-4-5']) {
      expect(parseSelectedKeys(raw, KEYS)).toEqual(new Set(['1', '4', '5']));
    }
  });

  it('acepta un array', () => {
    expect(parseSelectedKeys(['1', '4'], KEYS)).toEqual(new Set(['1', '4']));
  });

  it('normaliza a mayúsculas y descarta espacios', () => {
    expect(parseSelectedKeys(' a , c ', ['A', 'B', 'C'])).toEqual(new Set(['A', 'C']));
  });

  it('en blanco → conjunto vacío, no null', () => {
    expect(parseSelectedKeys('', KEYS)).toEqual(new Set());
    expect(parseSelectedKeys('   ', KEYS)).toEqual(new Set());
  });

  // Si las keys tienen más de un carácter, "A1B2" es ambiguo: no hay forma de
  // saber si son A1+B2 o A+1B+2. Adivinar corregiría mal sin fallar nunca.
  it('NO adivina la forma concatenada con keys multi-carácter', () => {
    expect(parseSelectedKeys('A1B2', ['A1', 'B2', 'C3'])).toBeNull();
  });

  it('pero acepta una key multi-carácter que calza entera', () => {
    expect(parseSelectedKeys('A1', ['A1', 'B2', 'C3'])).toEqual(new Set(['A1']));
  });

  it('lo que no es string ni array de strings → null', () => {
    expect(parseSelectedKeys(null, KEYS)).toBeNull();
    expect(parseSelectedKeys(42, KEYS)).toBeNull();
    expect(parseSelectedKeys([1, 2], KEYS)).toBeNull();
  });
});

describe('correctKeysOf / sameKeySet', () => {
  const alternatives = [
    { key: '1', isCorrect: true },
    { key: '2', isCorrect: false },
    { key: '5', isCorrect: true },
  ];

  it('extrae las correctas', () => {
    expect(correctKeysOf(alternatives)).toEqual(new Set(['1', '5']));
  });

  it('compara conjuntos sin importar el orden', () => {
    expect(sameKeySet(new Set(['5', '1']), new Set(['1', '5']))).toBe(true);
    expect(sameKeySet(new Set(['1']), new Set(['1', '5']))).toBe(false);
    expect(sameKeySet(new Set(['1', '2']), new Set(['1', '5']))).toBe(false);
  });
});

describe('hasMultipleCorrectAlternatives', () => {
  const alt = (isCorrect: boolean) => ({ key: 'x', text: 't', isCorrect });

  it('true con 2 o más correctas y alguna incorrecta', () => {
    expect(
      hasMultipleCorrectAlternatives({ alternatives: [alt(true), alt(true), alt(false)] }),
    ).toBe(true);
  });

  it('false con una sola correcta: eso es multiple_choice', () => {
    expect(
      hasMultipleCorrectAlternatives({ alternatives: [alt(true), alt(false), alt(false)] }),
    ).toBe(false);
  });

  it('false si TODAS son correctas: el ítem no discrimina', () => {
    expect(hasMultipleCorrectAlternatives({ alternatives: [alt(true), alt(true)] })).toBe(false);
  });

  it('false para contenidos sin alternativas', () => {
    expect(hasMultipleCorrectAlternatives({ prompt: 'x' })).toBe(false);
    expect(hasMultipleCorrectAlternatives(null)).toBe(false);
  });
});
