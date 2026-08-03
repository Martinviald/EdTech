import {
  TRUE_FALSE_KEYS,
  isTrueFalseContent,
  parseTrueFalseAnswer,
  trueFalseKeyOf,
} from './true-false';

describe('parseTrueFalseAnswer', () => {
  it('reconoce las variantes de verdadero', () => {
    for (const raw of ['V', 'v', ' Verdadero ', 'TRUE', 'true', 'T', 'SI', 'SÍ', '1', 'A']) {
      expect(parseTrueFalseAnswer(raw)).toBe(true);
    }
  });

  it('reconoce las variantes de falso', () => {
    for (const raw of ['F', 'f', ' Falso ', 'FALSE', 'NO', '0', 'B']) {
      expect(parseTrueFalseAnswer(raw)).toBe(false);
    }
  });

  it('no adivina: lo desconocido y lo no-string dan null', () => {
    for (const raw of ['X', '', 'quizás', null, undefined, 3, {}]) {
      expect(parseTrueFalseAnswer(raw)).toBeNull();
    }
  });
});

describe('trueFalseKeyOf', () => {
  it('colapsa todas las variantes a la clave canónica', () => {
    expect(trueFalseKeyOf('VERDADERO')).toBe(TRUE_FALSE_KEYS.true);
    expect(trueFalseKeyOf('A')).toBe(TRUE_FALSE_KEYS.true);
    expect(trueFalseKeyOf('F')).toBe(TRUE_FALSE_KEYS.false);
    expect(trueFalseKeyOf('B')).toBe(TRUE_FALSE_KEYS.false);
    expect(trueFalseKeyOf('X')).toBeNull();
  });
});

describe('isTrueFalseContent', () => {
  it('decide por el dato, no por el tipo declarado', () => {
    expect(isTrueFalseContent({ stem: 'x', correctAnswer: true })).toBe(true);
    expect(isTrueFalseContent({ stem: 'x', correctAnswer: false })).toBe(true);
    expect(isTrueFalseContent({ stem: 'x', alternatives: [] })).toBe(false);
    expect(isTrueFalseContent({ correctAnswer: 'true' })).toBe(false);
    expect(isTrueFalseContent(null)).toBe(false);
  });
});
