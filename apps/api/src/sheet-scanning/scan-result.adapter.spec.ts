import type { MultipleChoiceContent } from '@soe/types';
import {
  buildPrintedLabelIndex,
  resolveRowAnswers,
  type ResolvableItem,
} from '../answer-sheets/lib/composite-answers';
import {
  toParserResult,
  type ConfirmedScanInput,
  type ConfirmedScanMarkInput,
} from './scan-result.adapter';

function mark(overrides: Partial<ConfirmedScanMarkInput> = {}): ConfirmedScanMarkInput {
  return { printedNumber: '1', state: 'marked', value: 'A', ...overrides };
}

function scan(overrides: Partial<ConfirmedScanInput> = {}): ConfirmedScanInput {
  return {
    sequence: 1,
    studentRut: '12345678-5',
    studentFullName: 'Ana Pérez',
    marks: [],
    ...overrides,
  };
}

describe('toParserResult', () => {
  it('convierte una hoja feliz completa en una fila con sus respuestas', () => {
    const result = toParserResult([
      scan({
        sequence: 3,
        marks: [
          mark({ printedNumber: '1', value: 'A' }),
          mark({ printedNumber: '2', value: 'C' }),
          mark({ printedNumber: '3', value: 'E' }),
        ],
      }),
    ]);

    expect(result.rows).toEqual([
      {
        rowNumber: 3,
        studentRut: '12345678-5',
        studentFullName: 'Ana Pérez',
        answers: { '1': 'A', '2': 'C', '3': 'E' },
        errors: [],
      },
    ]);
    expect(result.detectedColumns).toEqual(['1', '2', '3']);
    expect(result.warnings).toEqual([]);
  });

  it('blank produce null sin error de fila', () => {
    const result = toParserResult([
      scan({ marks: [mark({ printedNumber: '4', state: 'blank', value: null })] }),
    ]);

    expect(result.rows[0]?.answers).toEqual({ '4': null });
    expect(result.rows[0]?.errors).toEqual([]);
  });

  it('multiple sin revisar produce null + error ambiguous_mark', () => {
    const result = toParserResult([
      scan({ sequence: 7, marks: [mark({ printedNumber: '5', state: 'multiple', value: null })] }),
    ]);

    expect(result.rows[0]?.answers).toEqual({ '5': null });
    expect(result.rows[0]?.errors).toEqual([
      {
        rowNumber: 7,
        field: '5',
        code: 'ambiguous_mark',
        message: expect.stringContaining('múltiple'),
      },
    ]);
  });

  it('ambiguous sin revisar produce null + error ambiguous_mark', () => {
    const result = toParserResult([
      scan({
        sequence: 2,
        marks: [mark({ printedNumber: '9', state: 'ambiguous', value: 'B' })],
      }),
    ]);

    expect(result.rows[0]?.answers).toEqual({ '9': null });
    expect(result.rows[0]?.errors).toEqual([
      {
        rowNumber: 2,
        field: '9',
        code: 'ambiguous_mark',
        message: expect.stringContaining('ambigua'),
      },
    ]);
  });

  it('reviewedValue corrige un multiple: usa el valor revisado y no emite error', () => {
    const result = toParserResult([
      scan({
        marks: [mark({ printedNumber: '5', state: 'multiple', value: null, reviewedValue: 'D' })],
      }),
    ]);

    expect(result.rows[0]?.answers).toEqual({ '5': 'D' });
    expect(result.rows[0]?.errors).toEqual([]);
  });

  it('reviewedValue null explícito = el humano decidió blanco, sin error', () => {
    const result = toParserResult([
      scan({
        marks: [
          mark({ printedNumber: '6', state: 'ambiguous', value: 'A', reviewedValue: null }),
        ],
      }),
    ]);

    expect(result.rows[0]?.answers).toEqual({ '6': null });
    expect(result.rows[0]?.errors).toEqual([]);
  });

  it('reviewedValue también pisa una marca marked', () => {
    const result = toParserResult([
      scan({ marks: [mark({ printedNumber: '8', state: 'marked', value: 'A', reviewedValue: 'B' })] }),
    ]);

    expect(result.rows[0]?.answers).toEqual({ '8': 'B' });
  });

  it('preserva la sub-numeración impresa tal cual (19.1..19.5)', () => {
    const subNumbers = ['19.1', '19.2', '19.3', '19.4', '19.5'];
    const result = toParserResult([
      scan({ marks: subNumbers.map((n) => mark({ printedNumber: n, value: 'V' })) }),
    ]);

    expect(Object.keys(result.rows[0]?.answers ?? {})).toEqual(subNumbers);
    expect(result.detectedColumns).toEqual(subNumbers);
  });

  it('una hoja sin marcas produce una fila con answers vacío', () => {
    const result = toParserResult([scan({ sequence: 12, marks: [] })]);

    expect(result.rows).toEqual([
      {
        rowNumber: 12,
        studentRut: '12345678-5',
        studentFullName: 'Ana Pérez',
        answers: {},
        errors: [],
      },
    ]);
    expect(result.detectedColumns).toEqual([]);
  });

  it('sin hojas produce un ParserResult vacío', () => {
    expect(toParserResult([])).toEqual({ rows: [], detectedColumns: [], warnings: [] });
  });

  it('detectedColumns respeta el orden de primera aparición entre varias hojas', () => {
    const result = toParserResult([
      scan({ sequence: 1, marks: [mark({ printedNumber: '2' }), mark({ printedNumber: '1' })] }),
      scan({ sequence: 2, marks: [mark({ printedNumber: '1' }), mark({ printedNumber: '3' })] }),
    ]);

    expect(result.detectedColumns).toEqual(['2', '1', '3']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.rowNumber)).toEqual([1, 2]);
  });

  it('una hoja de reserva viaja con rut y nombre null', () => {
    const result = toParserResult([
      scan({
        studentRut: null,
        studentFullName: null,
        marks: [mark({ printedNumber: '1', value: 'B' })],
      }),
    ]);

    expect(result.rows[0]?.studentRut).toBeNull();
    expect(result.rows[0]?.studentFullName).toBeNull();
    expect(result.rows[0]?.answers).toEqual({ '1': 'B' });
  });

  it('el resultado calza con composite-answers: las keys resuelven contra el instrumento', () => {
    const content: MultipleChoiceContent = {
      stem: 'x',
      alternatives: [
        { key: 'A', text: 'a', isCorrect: true },
        { key: 'B', text: 'b', isCorrect: false },
      ],
    };
    const items: ResolvableItem[] = [
      { position: 1, type: 'multiple_choice', content },
      { position: 2, type: 'multiple_choice', content, printedNumber: '19.1' },
      { position: 3, type: 'multiple_choice', content, printedNumber: '19.2' },
    ];
    const index = buildPrintedLabelIndex(items);

    const result = toParserResult([
      scan({
        marks: [
          mark({ printedNumber: '1', value: 'A' }),
          mark({ printedNumber: '19.1', value: 'B' }),
          mark({ printedNumber: '19.2', state: 'blank', value: null }),
        ],
      }),
    ]);

    const resolved = resolveRowAnswers(index, result.rows[0]?.answers ?? {});
    expect(resolved.unmatchedLabels).toEqual([]);
    expect(resolved.byPosition.get(1)).toBe('A');
    expect(resolved.byPosition.get(2)).toBe('B');
    expect(resolved.byPosition.get(3)).toBeNull();
  });
});
