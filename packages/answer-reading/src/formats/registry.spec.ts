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

  it('los formatos sin definición se rechazan explícitamente', () => {
    const freeText: ResponseFormat = { kind: 'free_text', lines: 4 };
    expect(isSupportedFormat(freeText)).toBe(false);
    expect(() => normalizeTranscription(fakeOutput('hola'), freeText)).toThrow(
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

  it('el literal manda; las partes solo marcan discrepancias', () => {
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
    expect(disagree.canonical).toBe('f:3/4');
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
