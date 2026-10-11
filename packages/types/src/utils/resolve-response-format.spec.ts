import { resolveResponseFormat } from './resolve-response-format';
import type { ItemType } from '../enums';

function shortAnswer(acceptedAnswers: string[], extra: Record<string, unknown> = {}) {
  return {
    type: 'short_answer' as ItemType,
    content: { prompt: 'Responde', acceptedAnswers, ...extra },
  };
}

describe('resolveResponseFormat', () => {
  it('respeta el formato declarado en content.responseFormat', () => {
    const declared = { kind: 'integer', maxChars: 3, allowNegative: true } as const;
    expect(resolveResponseFormat(shortAnswer(['21/10'], { responseFormat: declared }))).toEqual(
      declared,
    );
  });

  it('ignora un responseFormat inválido y deduce desde la clave', () => {
    const item = shortAnswer(['847'], { responseFormat: { kind: 'integer', maxChars: 0 } });
    expect(resolveResponseFormat(item)).toEqual({
      kind: 'integer',
      maxChars: 5,
      allowNegative: false,
    });
  });

  it('847 es entero con dos casillas de holgura', () => {
    expect(resolveResponseFormat(shortAnswer(['847']))).toEqual({
      kind: 'integer',
      maxChars: 5,
      allowNegative: false,
    });
  });

  it('-135 es entero que admite negativo; el signo no cuenta como carácter', () => {
    expect(resolveResponseFormat(shortAnswer(['-135']))).toEqual({
      kind: 'integer',
      maxChars: 5,
      allowNegative: true,
    });
  });

  it('10,962 es decimal y la coma cuenta como carácter', () => {
    expect(resolveResponseFormat(shortAnswer(['10,962']))).toEqual({
      kind: 'decimal',
      maxChars: 8,
      allowNegative: false,
    });
  });

  it('un entero junto a una variante decimal se imprime como decimal', () => {
    expect(resolveResponseFormat(shortAnswer(['2', '2,0']))).toMatchObject({ kind: 'decimal' });
  });

  it('21/10 es fracción sin número mixto', () => {
    expect(resolveResponseFormat(shortAnswer(['21/10']))).toEqual({
      kind: 'fraction',
      allowNegative: false,
      allowMixed: false,
    });
  });

  it('una clave mixta habilita el número mixto', () => {
    expect(resolveResponseFormat(shortAnswer(['21/10', '2 1/10']))).toEqual({
      kind: 'fraction',
      allowNegative: false,
      allowMixed: true,
    });
  });

  it('(7;3) es par ordenado de enteros', () => {
    expect(resolveResponseFormat(shortAnswer(['(7;3)']))).toEqual({
      kind: 'ordered_tuple',
      arity: 2,
      componentKind: 'integer',
    });
  });

  it('(5,6) con comparación sequence también es par ordenado', () => {
    expect(resolveResponseFormat(shortAnswer(['(5,6)'], { comparison: 'sequence' }))).toEqual({
      kind: 'ordered_tuple',
      arity: 2,
      componentKind: 'integer',
    });
  });

  it('un par con componentes fraccionarios declara componentKind fraction', () => {
    expect(resolveResponseFormat(shortAnswer(['(1/2; 3)']))).toMatchObject({
      kind: 'ordered_tuple',
      componentKind: 'fraction',
    });
  });

  it('3-1-4-2 es secuencia de cuatro posiciones', () => {
    expect(resolveResponseFormat(shortAnswer(['3-1-4-2']))).toEqual({
      kind: 'sequence',
      length: 4,
    });
  });

  it('una lista numérica con comas y comparación sequence es secuencia', () => {
    expect(resolveResponseFormat(shortAnswer(['2, 4, 3, 1'], { comparison: 'sequence' }))).toEqual({
      kind: 'sequence',
      length: 4,
    });
  });

  it('una clave de texto es texto corto con holgura de palabras', () => {
    expect(resolveResponseFormat(shortAnswer(['Cabeza, tórax, abdomen']))).toEqual({
      kind: 'short_text',
      maxWords: 5,
    });
  });

  it('comparison text manda sobre una clave numérica', () => {
    expect(resolveResponseFormat(shortAnswer(['847'], { comparison: 'text' }))).toEqual({
      kind: 'short_text',
      maxWords: 3,
    });
  });

  it('rubric_scored, open_ended y writing son texto libre', () => {
    expect(resolveResponseFormat({ type: 'rubric_scored', content: { prompt: 'x' } })).toEqual({
      kind: 'free_text',
      lines: 6,
    });
    expect(
      resolveResponseFormat({ type: 'open_ended', content: { prompt: 'x', maxWords: 45 } }),
    ).toEqual({ kind: 'free_text', lines: 5 });
    expect(resolveResponseFormat({ type: 'writing', content: { prompt: 'x' } })).toEqual({
      kind: 'free_text',
      lines: 15,
    });
  });

  it('matching y ordering se responden con burbujas', () => {
    expect(resolveResponseFormat({ type: 'matching', content: {} })).toEqual({
      kind: 'bubble_choice',
    });
    expect(resolveResponseFormat({ type: 'ordering', content: {} })).toEqual({
      kind: 'bubble_choice',
    });
  });

  it('los demás tipos no tienen formato derivable', () => {
    expect(resolveResponseFormat({ type: 'multiple_choice', content: {} })).toBeNull();
    expect(resolveResponseFormat({ type: 'oral_reading', content: { passage: 'x' } })).toBeNull();
    expect(resolveResponseFormat({ type: 'gap_fill', content: {} })).toBeNull();
  });
});
