import {
  getScoringStrategy,
  type ItemContent,
  type NormalizationIssue,
  type ResponseFormat,
  type ScoringConfig,
} from '@soe/types';
import { fakeOutput } from '../fake/fake-transcriber';
import { toScoringOutcome } from '../consensus/scoring-outcome';
import {
  ANSWER_FORMATS,
  formatLabelFor,
  requiresRubricGrading,
  isSupportedFormat,
  normalizeTranscription,
  outputPartsSchemaFor,
  promptGuideFor,
  toScoringInput,
} from './registry';
import { SUPPORTED_FORMAT_KINDS } from './answer-format';

const INTEGER: ResponseFormat = { kind: 'integer', maxChars: 6, allowNegative: true };
const DECIMAL: ResponseFormat = { kind: 'decimal', maxChars: 8, allowNegative: false };
const FRACTION: ResponseFormat = { kind: 'fraction', allowNegative: false, allowMixed: true };
const PAIR: ResponseFormat = { kind: 'ordered_tuple', arity: 2, componentKind: 'integer' };
const SEQUENCE: ResponseFormat = { kind: 'sequence', length: 4 };
const SEQUENCE_2: ResponseFormat = { kind: 'sequence', length: 2 };

function scoreAgainst(
  format: ResponseFormat,
  literal: string,
  accepted: string[],
  scoringConfig?: ScoringConfig,
) {
  const normalized = normalizeTranscription(fakeOutput(literal), format);
  const output = getScoringStrategy('short_answer').score({
    item: {
      id: 'item',
      type: 'short_answer',
      content: { prompt: '¿?', acceptedAnswers: accepted, responseFormat: format } as ItemContent,
      maxScore: 2,
      scoringConfig,
    },
    rawAnswer: toScoringInput(normalized),
  });
  return toScoringOutcome(output);
}

describe('registro de formatos', () => {
  it('tiene una definición por cada formato soportado, con su kind', () => {
    for (const kind of SUPPORTED_FORMAT_KINDS) {
      expect(ANSWER_FORMATS[kind].kind).toBe(kind);
      expect(ANSWER_FORMATS[kind].readBy).toBe('vision');
    }
  });

  it('los formatos sin definición (los de burbujas) se rechazan explícitamente', () => {
    const bubbles: ResponseFormat = { kind: 'bubble_choice' };
    expect(isSupportedFormat(bubbles)).toBe(false);
    expect(() => normalizeTranscription(fakeOutput('hola'), bubbles)).toThrow(
      /no tiene definición/,
    );
  });

  it('etiquetas y guías en español, sin mencionar claves', () => {
    expect(formatLabelFor(INTEGER)).toBe('número entero');
    expect(formatLabelFor(FRACTION)).toBe('fracción o número mixto');
    expect(formatLabelFor(PAIR)).toBe('par ordenado');
    expect(formatLabelFor(SEQUENCE)).toBe('secuencia de 4 elementos');
    for (const format of [INTEGER, DECIMAL, FRACTION, PAIR, SEQUENCE]) {
      expect(promptGuideFor(format)).not.toMatch(/clave|correct/i);
    }
  });

  it('pide las partes que usa cada formato', () => {
    expect(outputPartsSchemaFor(INTEGER)).toBeNull();
    expect(outputPartsSchemaFor(FRACTION)?.required).toEqual(['whole', 'numerator', 'denominator']);
    expect(outputPartsSchemaFor(PAIR)?.required).toEqual(['c1', 'c2']);
    expect(outputPartsSchemaFor(SEQUENCE)?.required).toEqual(['e1', 'e2', 'e3', 'e4']);
  });
});

type Row = [string, ResponseFormat, string, string | null, NormalizationIssue[]];

describe('normalize — tabla de casos (incluye errores del experimento)', () => {
  const rows: Row[] = [
    ['entero', INTEGER, '68', 'n:68', []],
    ['entero negativo tipográfico', INTEGER, '−12', 'n:-12', []],
    ['8 leído como γ: no se interpreta', INTEGER, 'γ2', null, ['non_numeric_in_numeric']],
    ['letra en entero', INTEGER, '1S', null, ['non_numeric_in_numeric']],
    ['decimal en formato entero', INTEGER, '2,5', 'n:5/2', ['format_mismatch']],
    ['coma decimal', DECIMAL, '2,5', 'n:5/2', []],
    ['punto decimal', DECIMAL, '2.5', 'n:5/2', []],
    ['cero a la izquierda (02,5)', DECIMAL, '02,5', 'n:5/2', []],
    ['ceros a la derecha', DECIMAL, '2,50', 'n:5/2', []],
    ['0,025 conserva el valor', DECIMAL, '0,025', 'n:1/40', []],
    ['1.82 con punto', DECIMAL, '1.82', 'n:91/50', []],
    ['negativo no permitido', DECIMAL, '-2,5', 'n:-5/2', ['format_mismatch']],
    [
      'miles ambiguo',
      DECIMAL,
      '250.000',
      'amb:n:250||n:250000',
      ['ambiguous_thousands_or_decimal'],
    ],
    ['fracción', FRACTION, '3/4', 'f:3/4', []],
    ['fracción no simplificada', FRACTION, '6/8', 'f:6/8', []],
    ['número mixto', FRACTION, '1 1/2', 'f:1 1/2', []],
    ['decimal en formato fracción', FRACTION, '0,75', 'n:3/4', ['format_mismatch']],
    ['denominador 0', FRACTION, '3/0', null, ['non_numeric_in_numeric']],
    ['par con punto y coma', PAIR, '(7;3)', 't:7|3', []],
    ['par de GradeCam', PAIR, '[7#3]', 't:7|3', []],
    ['par con espacio', PAIR, '7 3', 't:7|3', []],
    ['par con coma sin paréntesis', PAIR, '7,3', 't:7|3', []],
    ['terna en un par', PAIR, '(7;3;1)', 't:7|3|1', ['format_mismatch']],
    ['par con decimal en componente entero', PAIR, '(2,5;3)', 't:2.5|3', ['format_mismatch']],
    ['secuencia con guiones', SEQUENCE, '3-1-4-2', 's:3|1|4|2', []],
    ['secuencia pegada', SEQUENCE, '3142', 's:3|1|4|2', []],
    ['secuencia corta', SEQUENCE, '3-1-4', 's:3|1|4', ['format_mismatch']],
    ['entero con punto de miles', INTEGER, '1.500', 'n:1500', []],
    ['secuencia de 2 pegada no se separa', SEQUENCE_2, '12', 's:12', ['format_mismatch']],
    ['secuencia de 2 con separador', SEQUENCE_2, '1-2', 's:1|2', []],
  ];

  it.each(rows)('%s', (_name, format, literal, canonical, issues) => {
    const normalized = normalizeTranscription(fakeOutput(literal), format);
    expect(normalized.formatKind).toBe(format.kind);
    expect(normalized.state).toBe('answered');
    expect(normalized.canonical).toBe(canonical);
    expect(normalized.issues.sort()).toEqual([...issues].sort());
    if (canonical === null) expect(normalized.value).toBeNull();
  });

  it('un estado distinto de answered no tiene valor', () => {
    for (const state of ['blank', 'illegible', 'crossed_out_only', 'multiple_answers'] as const) {
      const normalized = normalizeTranscription(fakeOutput('5', { state }), INTEGER);
      expect(normalized).toEqual({
        formatKind: 'integer',
        state,
        canonical: null,
        value: null,
        issues: [],
      });
    }
  });

  it('respondida pero vacía es una parte vacía, no un cero', () => {
    const normalized = normalizeTranscription(fakeOutput(''), INTEGER);
    expect(normalized.canonical).toBeNull();
    expect(normalized.issues).toContain('empty_part');
  });

  it('las partes completas mandan; el literal que las contradice se marca', () => {
    const agree = normalizeTranscription(
      fakeOutput('3/4', { parts: { whole: '', numerator: '3', denominator: '4' } }),
      FRACTION,
    );
    expect(agree.canonical).toBe('f:3/4');
    expect(agree.issues).toEqual([]);
    const disagree = normalizeTranscription(
      fakeOutput('3/4', { parts: { whole: '', numerator: '3', denominator: '8' } }),
      FRACTION,
    );
    expect(disagree.canonical).toBe('f:3/8');
    expect(disagree.issues).toContain('parts_disagree_with_literal');
    const pair = normalizeTranscription(fakeOutput('(7;3)', { parts: { c1: '3', c2: '7' } }), PAIR);
    expect(pair.issues).toContain('parts_disagree_with_literal');
  });
});

describe('toScoringInput → corrección existente', () => {
  it('números: forma tolerada, cantidad distinta incorrecta', () => {
    expect(scoreAgainst(DECIMAL, '02,5', ['2.5'])).toBe('correct');
    expect(scoreAgainst(DECIMAL, '25', ['2,5'])).toBe('incorrect');
    expect(scoreAgainst(INTEGER, '−12', ['-12'])).toBe('correct');
  });

  it('el número ambiguo queda indecidible si las lecturas cambian el resultado', () => {
    expect(scoreAgainst(DECIMAL, '1.500', ['1500'])).toBe('undecidable');
    expect(scoreAgainst(DECIMAL, '1.500', ['7'])).toBe('incorrect');
  });

  it('fracciones: equivalente vale, decimal no salvo que la pauta lo diga', () => {
    expect(scoreAgainst(FRACTION, '6/8', ['3/4'])).toBe('correct');
    expect(scoreAgainst(FRACTION, '1 1/2', ['3/2'])).toBe('correct');
    expect(scoreAgainst(FRACTION, '0,75', ['3/4'])).toBe('incorrect');
    expect(
      scoreAgainst(FRACTION, '0,75', ['3/4'], { equivalences: { acceptDecimalEquivalent: true } }),
    ).toBe('correct');
  });

  it('pares: el orden importa; crédito parcial solo con componentCredit', () => {
    expect(scoreAgainst(PAIR, '[7#3]', ['(7;3)'])).toBe('correct');
    expect(scoreAgainst(PAIR, '[3#7]', ['(7;3)'])).toBe('incorrect');
    expect(scoreAgainst(PAIR, '(2;4)', ['(2;-4)'])).toBe('incorrect');
    expect(
      scoreAgainst(PAIR, '(2;4)', ['(2;-4)'], {
        componentCredit: { mode: 'per_component', creditPerComponent: [0.5, 0.5] },
      }),
    ).toBe('partial');
  });

  it('secuencias pegadas o con separadores', () => {
    expect(scoreAgainst(SEQUENCE_2, '12', ['1-2'])).toBe('incorrect');
    expect(scoreAgainst(SEQUENCE, '3142', ['3-1-4-2'])).toBe('correct');
    expect(scoreAgainst(SEQUENCE, '3 1 2 4', ['3-1-4-2'])).toBe('incorrect');
  });

  it('sin valor no hay entrada de corrección', () => {
    expect(toScoringInput(normalizeTranscription(fakeOutput('γ2'), INTEGER))).toBeNull();
    expect(
      toScoringInput(normalizeTranscription(fakeOutput('', { state: 'blank' }), INTEGER)),
    ).toBeNull();
  });

  it('un par ambiguo por comas conserva la ambigüedad hasta la corrección', () => {
    const tuple3: ResponseFormat = { kind: 'ordered_tuple', arity: 2, componentKind: 'decimal' };
    expect(scoreAgainst(tuple3, '(2,5,3)', ['(2,5;3)'])).toBe('undecidable');
  });
});

const WORDS: ResponseFormat = { kind: 'word_list', count: 3 };
const SENTENCE: ResponseFormat = { kind: 'short_text', maxWords: 6 };
const BOXES: ResponseFormat = {
  kind: 'multi_box',
  boxes: [
    { partId: 'tens', label: 'Decenas', kind: 'integer' },
    { partId: 'units', label: 'Unidades', kind: 'decimal' },
    { partId: 'name', label: 'Nombre', kind: 'short_text' },
  ],
};
const FREE_TEXT: ResponseFormat = { kind: 'free_text', lines: 6 };
const MATH_WORK: ResponseFormat = { kind: 'math_work', heightRatio: 0.4 };

function scoreShortAnswer(
  format: ResponseFormat,
  literal: string,
  accepted: string[],
  scoringConfig?: ScoringConfig,
) {
  return scoreAgainst(format, literal, accepted, scoringConfig);
}

function scoreBoxes(literal: string, scoringConfig?: ScoringConfig) {
  const normalized = normalizeTranscription(fakeOutput(literal), BOXES);
  const output = getScoringStrategy('gap_fill').score({
    item: {
      id: 'item',
      type: 'gap_fill',
      content: {
        textWithGaps: 'Decenas: ___ Unidades: ___ Nombre: ___',
        gaps: [
          { position: 0, partId: 'tens', acceptedAnswers: ['3'] },
          { position: 1, partId: 'units', acceptedAnswers: ['4,5'] },
          { position: 2, partId: 'name', acceptedAnswers: ['Ana'] },
        ],
        responseFormat: BOXES,
      } as ItemContent,
      maxScore: 3,
      scoringConfig,
    },
    rawAnswer: toScoringInput(normalized),
  });
  return output;
}

describe('formatos de texto, casillas y desarrollo (F10a)', () => {
  it('etiquetas, partes y modo de calificación', () => {
    expect(formatLabelFor(WORDS)).toBe('lista de 3 palabras');
    expect(formatLabelFor({ kind: 'word_list', count: 1 })).toBe('una palabra');
    expect(formatLabelFor(SENTENCE)).toBe('texto corto');
    expect(formatLabelFor(BOXES)).toBe('3 casillas: Decenas, Unidades, Nombre');
    expect(formatLabelFor(FREE_TEXT)).toBe('respuesta de desarrollo');
    expect(outputPartsSchemaFor(WORDS)?.required).toEqual(['w1', 'w2', 'w3']);
    expect(outputPartsSchemaFor(SENTENCE)).toBeNull();
    expect(outputPartsSchemaFor(BOXES)?.required).toEqual(['tens', 'units', 'name']);
    expect(outputPartsSchemaFor(FREE_TEXT)).toBeNull();
    for (const format of [WORDS, SENTENCE, BOXES, FREE_TEXT, MATH_WORK]) {
      expect(promptGuideFor(format)).not.toMatch(/clave|correct[ao]/i);
      expect(promptGuideFor(format)).not.toMatch(/\b(vos|tenés|podés|marcá|copiá|dejá)\b/);
    }
    expect(promptGuideFor(FREE_TEXT)).toMatch(/\[ilegible\]/);
    expect(requiresRubricGrading(FREE_TEXT)).toBe(true);
    expect(requiresRubricGrading(MATH_WORK)).toBe(true);
    expect(requiresRubricGrading(WORDS)).toBe(false);
    expect(requiresRubricGrading({ kind: 'bubble_choice' })).toBe(false);
  });

  it.each<[string, ResponseFormat, string, string | null, NormalizationIssue[]]>([
    ['lista con comas', WORDS, 'Cabeza, tórax, abdomen', 'w:cabeza|torax|abdomen', []],
    ['lista con "y" y punto', WORDS, 'cabeza; Tórax y abdomen.', 'w:cabeza|torax|abdomen', []],
    ['lista con palabras de más', WORDS, 'a, b, c, d', 'w:a|b|c|d', ['extra_tokens']],
    ['lista vacía', WORDS, ' , ', null, ['empty_part']],
    ['texto corto', SENTENCE, '“Pedro is cooking.”', 'x:pedro is cooking', []],
    ['casillas', BOXES, '3 | 4,5 | Ana', 'm:name=x:ana;tens=n:3;units=n:9/2', []],
    ['casilla vacía', BOXES, '3 |  | Ana', 'm:name=x:ana;tens=n:3;units=x:', ['empty_part']],
    [
      'decimal en casilla entera',
      BOXES,
      '3,5 | 4 | Ana',
      'm:name=x:ana;tens=n:7/2;units=n:4',
      ['format_mismatch'],
    ],
    ['faltan casillas', BOXES, '3 | 4', null, ['format_mismatch']],
    ['letra en casilla numérica', BOXES, 'x | 4 | Ana', null, ['non_numeric_in_numeric']],
    [
      'casilla ambigua',
      BOXES,
      '3 | 1.500 | Ana',
      'amb:m:name=x:ana;tens=n:3;units=n:1500||m:name=x:ana;tens=n:3;units=n:3/2',
      ['ambiguous_thousands_or_decimal'],
    ],
    [
      'desarrollo',
      FREE_TEXT,
      '  El agua  se evapora\n\n\n\npor el calor ',
      'x:El agua se evapora\n\npor el calor',
      [],
    ],
    ['desarrollo vacío', FREE_TEXT, '   ', null, ['empty_part']],
    ['procedimiento', MATH_WORK, '3 + 4 = 7', 'x:3 + 4 = 7', []],
  ])('%s', (_name, format, literal, canonical, issues) => {
    const normalized = normalizeTranscription(fakeOutput(literal), format);
    expect(normalized.formatKind).toBe(format.kind);
    expect(normalized.canonical).toBe(canonical);
    expect([...normalized.issues].sort()).toEqual([...issues].sort());
  });

  it('el literal que contradice las partes se marca', () => {
    const words = normalizeTranscription(
      fakeOutput('cabeza, tórax, abdomen', { parts: { w1: 'cabeza', w2: 'tórax', w3: 'patas' } }),
      WORDS,
    );
    expect(words.canonical).toBe('w:cabeza|torax|patas');
    expect(words.issues).toContain('parts_disagree_with_literal');
    const fewer = normalizeTranscription(
      fakeOutput('cabeza, tórax', { parts: { w1: 'cabeza', w2: 'tórax', w3: '' } }),
      WORDS,
    );
    expect(fewer.issues).toEqual([]);
    const boxes = normalizeTranscription(
      fakeOutput('3 | 4,5 | Ana', { parts: { tens: '3', units: '4.5', name: 'ana' } }),
      BOXES,
    );
    expect(boxes.issues).toEqual([]);
    const boxesDisagree = normalizeTranscription(
      fakeOutput('3 | 4,5 | Ana', { parts: { tens: '8', units: '4,5', name: 'Ana' } }),
      BOXES,
    );
    expect(boxesDisagree.issues).toContain('parts_disagree_with_literal');
  });

  it('lista de palabras → corrección de short_answer', () => {
    expect(scoreShortAnswer(WORDS, 'cabeza, torax, abdomen', ['Cabeza, tórax, abdomen'])).toBe(
      'correct',
    );
    expect(scoreShortAnswer(WORDS, 'cabeza, torax, abdomem', ['Cabeza, tórax, abdomen'])).toBe(
      'undecidable',
    );
    expect(scoreShortAnswer(WORDS, 'cabeza, torax, patas', ['Cabeza, tórax, abdomen'])).toBe(
      'incorrect',
    );
    expect(
      scoreShortAnswer(WORDS, 'cabeza, torax, patas', ['Cabeza, tórax, abdomen'], {
        componentCredit: { mode: 'per_component', creditPerComponent: [1 / 3, 1 / 3, 1 / 3] },
      }),
    ).toBe('partial');
  });

  it('texto corto → correcta solo si calza exacta; si no, indecidible', () => {
    expect(scoreShortAnswer(SENTENCE, 'Pedro is cooking', ['Pedro is cooking.'])).toBe('correct');
    expect(scoreShortAnswer(SENTENCE, 'Pedro cooks', ['Pedro is cooking.'])).toBe('undecidable');
  });

  it('casillas → gap_fill por casilla, con crédito solo si la pauta lo dice', () => {
    expect(scoreBoxes('03 | 4.5 | ana').isCorrect).toBe(true);
    expect(scoreBoxes('3 | 4,5 | Eva')).toEqual({
      isCorrect: null,
      rawScore: null,
      requiresManualGrading: true,
    });
    expect(scoreBoxes('3 | 7 | Ana')).toEqual({
      isCorrect: false,
      rawScore: 0,
      requiresManualGrading: false,
    });
    expect(scoreBoxes('3 | 7 | Ana', { partialCredit: true }).rawScore).toBe(0);
    expect(
      scoreBoxes('3 | 7 | Ana', {
        componentCredit: { mode: 'per_component', creditPerComponent: [1 / 3, 1 / 3, 1 / 3] },
      }).rawScore,
    ).toBeCloseTo(2);
  });

  it('desarrollo: el texto pasa sin estructura', () => {
    const normalized = normalizeTranscription(fakeOutput('El agua se evapora'), FREE_TEXT);
    expect(normalized.value).toEqual({ type: 'text', text: 'El agua se evapora' });
    expect(toScoringInput(normalized)).toBe('El agua se evapora');
    expect(
      toScoringInput(normalizeTranscription(fakeOutput('', { state: 'blank' }), FREE_TEXT)),
    ).toBeNull();
  });
});

describe('fotos reales: en formatos con partes, las partes mandan', () => {
  const SIGNED_BOXES: ResponseFormat = {
    kind: 'multi_box',
    boxes: [
      { kind: 'integer', label: 'Decenas:', partId: 'd' },
      { kind: 'integer', label: 'Unidades:', partId: 'u', operatorBefore: '+' },
      { kind: 'integer', label: 'Total:', partId: 't', operatorBefore: '=' },
    ],
  };
  const TWO_WORDS: ResponseFormat = { kind: 'word_list', count: 2 };
  const SEQUENCE_3: ResponseFormat = { kind: 'sequence', length: 3 };

  const read = (format: ResponseFormat, literal: string, parts: Record<string, string>) =>
    normalizeTranscription(fakeOutput(literal, { parts }), format);

  it.each<
    [string, ResponseFormat, string, Record<string, string>, string | null, NormalizationIssue[]]
  >([
    [
      'Bruno P9 Gemini: literal con los signos impresos',
      SIGNED_BOXES,
      '40 + 7 = 47',
      { d: '40', u: '7', t: '47' },
      'm:d=n:40;t=n:47;u=n:7',
      ['literal_subset_of_parts'],
    ],
    [
      'Bruno P9 Haiku: literal de la pregunta vecina contradice las partes',
      SIGNED_BOXES,
      'productos',
      { d: '40', u: '7', t: '47' },
      'm:d=n:40;t=n:47;u=n:7',
      ['parts_disagree_with_literal'],
    ],
    [
      'Celeste P9: el literal trae solo el total',
      SIGNED_BOXES,
      '47',
      { d: '4', u: '7', t: '47' },
      'm:d=n:4;t=n:47;u=n:7',
      ['literal_subset_of_parts'],
    ],
    [
      'Ámbar P9 Haiku: el literal trae solo la primera casilla',
      SIGNED_BOXES,
      '40',
      { d: '40', u: '7', t: '47' },
      'm:d=n:40;t=n:47;u=n:7',
      ['literal_subset_of_parts'],
    ],
    [
      'Ámbar P7 Haiku: palabras sin separador en el literal',
      TWO_WORDS,
      'triángulo cuadrilátero',
      { w1: 'triángulo', w2: 'cuadrilátero' },
      'w:triangulo|cuadrilatero',
      ['literal_subset_of_parts'],
    ],
    [
      'Bruno P7 Gemini: el literal tiene una palabra que las partes perdieron',
      TWO_WORDS,
      'triangulo isoseles cuadrado',
      { w1: 'triangulo', w2: 'cuadrado' },
      'w:triangulo|cuadrado',
      ['parts_disagree_with_literal'],
    ],
    [
      'Bruno P5 Gemini: literal y partes coinciden',
      SEQUENCE_3,
      '8, 10, 12',
      { e1: '8', e2: '10', e3: '12' },
      's:8|10|12',
      [],
    ],
    [
      'Bruno P5 Haiku: casillas vacías siguen siendo partes vacías',
      SEQUENCE_3,
      '8',
      { e1: '8', e2: '', e3: '' },
      's:8',
      ['empty_part', 'format_mismatch'],
    ],
    [
      'Bruno P6 Gemini: el literal trae solo el primer valor',
      PAIR,
      '3',
      { c1: '3', c2: '5' },
      't:3|5',
      ['literal_subset_of_parts'],
    ],
    [
      'literal vacío con partes completas',
      PAIR,
      '',
      { c1: '3', c2: '5' },
      't:3|5',
      ['literal_subset_of_parts'],
    ],
    [
      'el literal invierte el orden: contradice',
      PAIR,
      '(7;3)',
      { c1: '3', c2: '7' },
      't:3|7',
      ['parts_disagree_with_literal'],
    ],
  ])('%s', (_name, format, literal, parts, canonical, issues) => {
    const normalized = read(format, literal, parts);
    expect(normalized.canonical).toBe(canonical);
    expect([...normalized.issues].sort()).toEqual([...issues].sort());
  });

  it('Ámbar P7 Haiku se corrige como correcta', () => {
    const normalized = read(TWO_WORDS, 'triángulo cuadrilátero', {
      w1: 'triángulo',
      w2: 'cuadrilátero',
    });
    const output = getScoringStrategy('short_answer').score({
      item: {
        id: 'item',
        type: 'short_answer',
        content: {
          prompt: '¿?',
          acceptedAnswers: ['triángulo, cuadrilátero'],
          responseFormat: TWO_WORDS,
        } as ItemContent,
        maxScore: 1,
      },
      rawAnswer: toScoringInput(normalized),
    });
    expect(toScoringOutcome(output)).toBe('correct');
  });

  it('partes no interpretables: se vuelve al literal', () => {
    const normalized = read(PAIR, '(3;5)', { c1: 'x', c2: '5' });
    expect(normalized.canonical).toBe('t:3|5');
    expect(normalized.issues).toContain('parts_disagree_with_literal');
  });
});
