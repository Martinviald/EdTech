import type { ResponseFormat, TranscriptionOutput } from '@soe/types';
import { fakeOutput } from '../fake/fake-transcriber';
import { boxCellGuide, numericCellsText } from './box-cells';
import { normalizeTranscription } from './registry';
import { numericBoxesFor, responseGeometryOf } from './response-geometry';
import { transcriptionJsonSchema, transcriptionZodSchema } from './transcription-json-schema';

const DECIMAL: ResponseFormat = { kind: 'decimal', maxChars: 6, allowNegative: false };
const INTEGER: ResponseFormat = { kind: 'integer', maxChars: 5, allowNegative: false };
const SIGNED: ResponseFormat = { kind: 'integer', maxChars: 3, allowNegative: true };
const TWO_DECIMALS = { fractionDigits: 2 };

function read(literal: string, parts: Record<string, string> | null): TranscriptionOutput {
  return { ...fakeOutput(literal), parts };
}

describe('geometría impresa', () => {
  it('deriva los decimales de la clave como la hoja y deja el resto por defecto', () => {
    expect(responseGeometryOf({ acceptedAnswers: ['3,75', '3.7'] })).toEqual({
      fractionDigits: 2,
    });
    expect(responseGeometryOf({ acceptedAnswers: ['100'] })).toEqual({ fractionDigits: null });
    expect(responseGeometryOf(null)).toEqual({ fractionDigits: null });
  });

  it('reparte las casillas como numberBlock: 6 caracteres = 3 casillas, coma y 2', () => {
    expect(numericBoxesFor({ ...DECIMAL }, 2)).toEqual({
      signBox: false,
      integerDigits: 3,
      fractionDigits: 2,
    });
    expect(numericBoxesFor({ ...DECIMAL }, null)).toMatchObject({ fractionDigits: 2 });
    expect(numericBoxesFor({ ...DECIMAL }, 9)).toMatchObject({
      integerDigits: 1,
      fractionDigits: 4,
    });
    expect(numericBoxesFor({ kind: 'integer', maxChars: 4, allowNegative: true }, 2)).toEqual({
      signBox: true,
      integerDigits: 4,
      fractionDigits: 0,
    });
  });
});

describe('esquema de la lectura por casilla', () => {
  it('pide una parte por casilla con la coma en el prefijo, y no cambia el esquema clásico', () => {
    const cells = transcriptionJsonSchema(DECIMAL, TWO_DECIMALS);
    expect(cells.schemaId).toBe('transcription-cells.decimal.i3f2@1');
    expect(cells.schema.properties.parts).toMatchObject({
      required: ['i1', 'i2', 'i3', 'f1', 'f2'],
    });
    expect(transcriptionJsonSchema(SIGNED, TWO_DECIMALS).schema.properties.parts).toMatchObject({
      required: ['sign', 'i1', 'i2', 'i3'],
    });
    expect(transcriptionJsonSchema(DECIMAL).schemaId).toBe('transcription-output.decimal@1');
    expect(transcriptionJsonSchema(DECIMAL).schema.properties.parts).toMatchObject({
      type: 'null',
    });
  });

  it('la secuencia conserva sus partes e1…eN', () => {
    const sequence: ResponseFormat = { kind: 'sequence', length: 3 };
    const cells = transcriptionJsonSchema(sequence, TWO_DECIMALS);
    expect(cells.schemaId).toBe('transcription-cells.sequence.3@1');
    expect(cells.schema.properties.parts).toEqual(
      transcriptionJsonSchema(sequence).schema.properties.parts,
    );
  });

  it('la validación exige las casillas del esquema', () => {
    const zod = transcriptionZodSchema(DECIMAL, TWO_DECIMALS);
    expect(zod.safeParse(read('2,75', { i1: '', i2: '', i3: '2', f1: '7', f2: '5' })).success).toBe(
      true,
    );
    expect(zod.safeParse(read('2,75', null)).success).toBe(false);
  });

  it('la guía describe las casillas y la coma impresa, sin la clave', () => {
    const guide = boxCellGuide(DECIMAL, TWO_DECIMALS);
    expect(guide).toMatch(/3 casillas, después una coma IMPRESA y después 2 casillas/);
    expect(guide).toMatch(/i1, i2, i3/);
    expect(guide).toMatch(/f1, f2/);
    expect(() => boxCellGuide({ kind: 'short_text', maxWords: 3 }, TWO_DECIMALS)).toThrow();
  });
});

describe('normalización desde las casillas', () => {
  it('arma el decimal con la coma de la geometría e ignora las casillas vacías', () => {
    const answer = normalizeTranscription(
      read('2,75', { i1: '', i2: '', i3: '2', f1: '7', f2: '5' }),
      DECIMAL,
    );
    expect(answer).toMatchObject({ canonical: 'n:11/4', issues: [] });
  });

  it('un literal con espacios o la coma impresa duplicada queda como control sin forzar revisión', () => {
    const answer = normalizeTranscription(
      read('2  ,,75', { i1: '2', i2: '', i3: '', f1: '7', f2: '5' }),
      DECIMAL,
    );
    expect(answer.canonical).toBe('n:11/4');
    expect(answer.issues).toEqual(['literal_subset_of_parts']);
  });

  it('un literal con un dígito que las casillas no traen fuerza revisión', () => {
    const answer = normalizeTranscription(
      read('1.2,75', { i1: '', i2: '', i3: '2', f1: '7', f2: '5' }),
      DECIMAL,
    );
    expect(answer.canonical).toBe('n:11/4');
    expect(answer.issues).toContain('parts_disagree_with_literal');
  });

  it('sin casillas antes de la coma no adivina el número: interpreta el literal y marca la parte vacía', () => {
    const answer = normalizeTranscription(
      read(',75', { i1: '', i2: '', i3: '', f1: '7', f2: '5' }),
      DECIMAL,
    );
    expect(answer.issues).toContain('empty_part');
  });

  it('un entero sin decimales escritos es el entero', () => {
    expect(
      normalizeTranscription(read('3', { i1: '', i2: '3', i3: '', f1: '', f2: '' }), DECIMAL),
    ).toMatchObject({ canonical: 'n:3', issues: [] });
  });

  it('el entero se arma con los dígitos de las casillas y el signo', () => {
    expect(
      normalizeTranscription(read('100', { i1: '', i2: '1', i3: '0', i4: '0', i5: '' }), INTEGER),
    ).toMatchObject({ canonical: 'n:100', issues: [] });
    expect(
      normalizeTranscription(read('-12', { sign: '-', i1: '', i2: '1', i3: '2' }), SIGNED),
    ).toMatchObject({ canonical: 'n:-12', issues: [] });
  });

  it('una casilla con algo que no es dígito no se interpreta desde las casillas', () => {
    const answer = normalizeTranscription(
      read('100', { i1: '1', i2: '0', i3: '0.', i4: '', i5: '' }),
      INTEGER,
    );
    expect(answer.canonical).toBe('n:100');
    expect(answer.issues).toContain('parts_disagree_with_literal');
  });

  it('las lecturas sin casillas se normalizan igual que antes', () => {
    expect(numericCellsText(null)).toBeNull();
    expect(normalizeTranscription(read('2,75', null), DECIMAL)).toMatchObject({
      canonical: 'n:11/4',
      issues: [],
    });
    expect(normalizeTranscription(read('2  ,75', null), DECIMAL).canonical).not.toBe('n:11/4');
  });
});
