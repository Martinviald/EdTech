import type { AnswerSpace, InterpretedReading, ResponseFormat } from '@soe/types';
import { verifyAnswer } from './verify-answer';
import type { AnswerVerificationInput, VerifiedAnswer } from './verified-answer';

const SHORT: ResponseFormat = { kind: 'short_text', maxWords: 4 };
const INTEGER: ResponseFormat = { kind: 'integer', maxChars: 4, allowNegative: false };
const DECIMAL: ResponseFormat = { kind: 'decimal', maxChars: 6, allowNegative: false };
const FRACTION: ResponseFormat = { kind: 'fraction', allowNegative: false, allowMixed: false };
const SEQUENCE: ResponseFormat = { kind: 'sequence', length: 4 };
const OPEN: AnswerSpace = { kind: 'open' };

function column(letter: string, texts: readonly string[]): AnswerSpace {
  return {
    kind: 'matching',
    codes: texts.map((text, position) => ({
      code: `${letter}.${position + 1}`,
      column: letter,
      index: String(position + 1),
      text,
    })),
  };
}

const DIGESTION = column('A', [
  'Intestino grueso',
  'Esófago',
  'Estómago',
  'Intestino delgado',
  'Hígado',
  'Recto',
]);
const ELECTRONS = column('A', [
  'Ha cedido un electrón',
  'Presenta un enlace iónico',
  'Ha ganado un electrón',
]);
const COLUMN_B = column('B', ['uno', 'dos', 'tres', 'cuatro', 'cinco']);
const SET_1_TO_6: AnswerSpace = {
  kind: 'option_set',
  ordered: false,
  options: ['1', '2', '3', '4', '5', '6'].map((id) => ({ id, text: null })),
};

function reading(
  literal: string,
  answer: string,
  extra: Partial<InterpretedReading> = {},
): InterpretedReading {
  return { literal, state: 'answered', answer, candidates: [], confidence: 0.95, ...extra };
}

function verify(
  own: InterpretedReading,
  format: ResponseFormat,
  space: AnswerSpace,
  other?: InterpretedReading,
  extra: Partial<AnswerVerificationInput> = {},
): VerifiedAnswer {
  return verifyAnswer({ reading: own, otherReading: other ?? null, format, space, ...extra });
}

function unique(result: VerifiedAnswer) {
  if (result.status !== 'unique') throw new Error(`se esperaba unique y vino ${result.status}`);
  return result;
}

describe('verifyAnswer · pareo', () => {
  it('acepta el código escrito con otro formato como directo', () => {
    for (const literal of ['A2', 'A. 2', 'a.2', 'A,2', 'A) 2', 'a - 2']) {
      const result = unique(verify(reading(literal, 'A.2'), SHORT, DIGESTION));
      expect(result.canonical).toBe('A.2');
      expect(result.strength).toBe('direct');
    }
  });

  it('el código junto a su propio texto sigue siendo directo', () => {
    const result = unique(verify(reading('A.2 / Esofago', 'A.2'), SHORT, DIGESTION));
    expect(result.strength).toBe('direct');
  });

  it('una confusión de glifo en espacio cerrado es inferida', () => {
    for (const [literal, code] of [
      ['AS', 'A.5'],
      ['A.S', 'A.5'],
      ['A.b', 'A.6'],
    ] as const) {
      const result = unique(verify(reading(literal, code), SHORT, DIGESTION));
      expect(result.canonical).toBe(code);
      expect(result.strength).toBe('inferred');
    }
  });

  it('el texto de la opción le gana a un código fuera del espacio', () => {
    const result = unique(verify(reading('A.9 / intestino delgado o', 'A.4'), SHORT, DIGESTION));
    expect(result.canonical).toBe('A.4');
    expect(result.strength).toBe('inferred');
  });

  it('el texto solo, sin código, se traduce a su opción', () => {
    const result = unique(verify(reading('ESTOMAGO', 'A.3'), SHORT, DIGESTION));
    expect(result.canonical).toBe('A.3');
    expect(result.strength).toBe('inferred');
  });

  it('el código de la otra columna no existe: manda el texto (B3 → A.1)', () => {
    const result = unique(
      verify(
        reading('Ha cedido un electrón = B3', 'B.3'),
        SHORT,
        ELECTRONS,
        reading('Ha cedido un electron = B.3', 'B.3'),
      ),
    );
    expect(result.canonical).toBe('A.1');
    expect(result.strength).not.toBe('direct');
  });

  it('una letra sola no existe en el espacio', () => {
    expect(verify(reading('B', 'B'), SHORT, DIGESTION).status).toBe('out_of_space');
  });

  it('dos códigos de la columna admitida son ambiguos', () => {
    const result = verify(reading('A.2, A.5', 'A.2 A.5'), SHORT, DIGESTION);
    expect(result.status).toBe('ambiguous');
  });

  it('si solo uno de dos códigos cae en la columna admitida, es una selección', () => {
    const result = unique(verify(reading('A.4, B.5', 'A.4 B.5'), SHORT, COLUMN_B));
    expect(result.canonical).toBe('B.5');
    expect(result.strength).toBe('selection');
  });

  it('una respuesta que el literal no contiene no se desprende', () => {
    expect(verify(reading('A.3', 'A.4'), SHORT, DIGESTION).status).toBe('not_derivable');
  });
});

describe('verifyAnswer · números', () => {
  it('toma lo que va después del último =', () => {
    const result = unique(verify(reading('900 - 273 = 627', '627'), INTEGER, OPEN));
    expect(result.answerText).toBe('627');
    expect(result.strength).toBe('direct');
  });

  it('sin =, una resta da dos números y no se desprende un resultado', () => {
    expect(verify(reading('900-273', '627'), INTEGER, OPEN).status).toBe('not_derivable');
  });

  it('quitar palabras o unidades es inferido', () => {
    for (const [literal, answer] of [
      ['43 estudiantes', '43'],
      ['43estudiantes', '43'],
      ['ay que sacar 1 bolita', '1'],
    ] as const) {
      const result = unique(verify(reading(literal, answer), INTEGER, OPEN));
      expect(result.strength).toBe('inferred');
    }
    expect(unique(verify(reading('11cM', '11'), DECIMAL, OPEN)).strength).toBe('inferred');
  });

  it('una frase con dos números es una selección', () => {
    const result = unique(
      verify(reading('30 personas usan el calzado talla 38', '30'), INTEGER, OPEN),
    );
    expect(result.strength).toBe('selection');
  });

  it('«no es 25, es 30» es una selección, nunca directa', () => {
    expect(unique(verify(reading('no es 25, es 30', '30'), INTEGER, OPEN)).strength).toBe(
      'selection',
    );
  });

  it('un valor repetido se colapsa', () => {
    expect(unique(verify(reading('5/4o5/4', '5/4'), FRACTION, OPEN)).strength).toBe('direct');
  });

  it('el decimal con coma o con cero final es el mismo valor', () => {
    expect(unique(verify(reading('11,50', '11.5'), DECIMAL, OPEN)).strength).toBe('direct');
  });

  it('nunca cambia un operador: 3-7 no es 3/7', () => {
    expect(verify(reading('3-7', '3/7'), FRACTION, OPEN).status).toBe('not_derivable');
  });

  it('nunca aparece un dígito que no está escrito: el 1 chileno no se corrige', () => {
    expect(verify(reading('27/10', '21/10'), FRACTION, OPEN).status).toBe('not_derivable');
  });

  it('-3 y 3- no son lo mismo', () => {
    const signed: ResponseFormat = { kind: 'integer', maxChars: 4, allowNegative: true };
    expect(verify(reading('3-', '-3'), signed, OPEN).status).toBe('not_derivable');
    expect(unique(verify(reading('-3', '-3'), signed, OPEN)).strength).toBe('direct');
  });
});

describe('verifyAnswer · conjuntos y secuencias', () => {
  it('saca las opciones de una frase y las ordena', () => {
    const result = unique(verify(reading('LAS CORRECTAS SON 5 y 4', '4 5'), SHORT, SET_1_TO_6));
    expect(result.canonical).toBe('4 5');
    expect(result.strength).toBe('inferred');
  });

  it('separa los dígitos pegados cuando las opciones son de un carácter', () => {
    expect(unique(verify(reading('1356', '1 3 5 6'), SHORT, SET_1_TO_6)).strength).toBe('direct');
  });

  it('una letra que no es opción deja la respuesta fuera del espacio', () => {
    expect(verify(reading('B y 5', 'B 5'), SHORT, SET_1_TO_6).status).toBe('out_of_space');
  });

  it('elegir parte de lo escrito es una selección', () => {
    expect(unique(verify(reading('1 3 y 5', '3 5'), SHORT, SET_1_TO_6)).strength).toBe('selection');
  });

  it('la secuencia escrita con separadores es directa', () => {
    expect(unique(verify(reading('3; 1; 4; 2', '3 1 4 2'), SEQUENCE, OPEN)).strength).toBe(
      'direct',
    );
  });
});

describe('verifyAnswer · estados del lector', () => {
  it('un blanco sin evidencia de tinta queda sin verificar', () => {
    const blank = reading('', '', { state: 'blank' });
    const result = verify(blank, INTEGER, OPEN);
    expect(result).toMatchObject({ status: 'blank', blankEvidence: 'unverified' });
    expect(verify(blank, INTEGER, OPEN, undefined, { ink: { hasInk: false } })).toMatchObject({
      status: 'blank',
      blankEvidence: 'ink_absent',
    });
    expect(verify(blank, INTEGER, OPEN, undefined, { ink: { hasInk: true } })).toMatchObject({
      blankEvidence: 'unverified',
    });
  });

  it('ilegible o sin respuesta es unreadable', () => {
    expect(verify(reading('??', '', { state: 'illegible' }), INTEGER, OPEN).status).toBe(
      'unreadable',
    );
    expect(verify(reading('algo', ''), INTEGER, OPEN).status).toBe('unreadable');
  });

  it('candidatos que se desprenden de lo escrito quedan ambiguos', () => {
    const result = verify(
      reading('3 2,5', '', { state: 'ambiguous', candidates: ['3', '2,5'] }),
      INTEGER,
      OPEN,
    );
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.candidates.map((candidate) => candidate.answerText)).toEqual(['3', '2,5']);
    }
  });

  it('un formato de rúbrica no se verifica', () => {
    const free: ResponseFormat = { kind: 'free_text', lines: 4 };
    expect(verify(reading('texto', 'texto'), free, OPEN).status).toBe('not_applicable');
  });
});

describe('verifyAnswer · respaldo del otro lector', () => {
  it('marca supported cuando el literal del otro sostiene la respuesta', () => {
    const result = unique(
      verify(reading('43 estudiantes', '43'), INTEGER, OPEN, reading('43estudiantes', '43')),
    );
    expect(result.crossSupport).toBe('supported');
  });

  it('marca unsupported cuando el otro leyó otra cosa', () => {
    const result = unique(
      verify(reading('43 estudiantes', '43'), INTEGER, OPEN, reading('4 estudiantes', '4')),
    );
    expect(result.crossSupport).toBe('unsupported');
  });

  it('sin otro lector, no_other', () => {
    expect(unique(verify(reading('45', '45'), INTEGER, OPEN)).crossSupport).toBe('no_other');
  });

  it('se desprende del literal del otro aunque el propio no lo sostenga', () => {
    const result = unique(verify(reading('1.2', 'A.2'), SHORT, DIGESTION, reading('A.2', 'A.2')));
    expect(result.canonical).toBe('A.2');
    expect(result.crossSupport).toBe('supported');
  });
});
