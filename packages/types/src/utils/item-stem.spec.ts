import { extractItemStem, extractItemStemPreview } from './item-stem';

describe('extractItemStem', () => {
  it('toma `stem` en los tipos con alternativas', () => {
    expect(extractItemStem({ stem: '¿Cuál es el resultado?', alternatives: [] })).toBe(
      '¿Cuál es el resultado?',
    );
  });

  it('toma `prompt` en desarrollo, respuesta corta y pauta', () => {
    expect(extractItemStem({ prompt: 'Demuestra que la estrategia es correcta.' })).toBe(
      'Demuestra que la estrategia es correcta.',
    );
    expect(extractItemStem({ prompt: 'Tiene ___ metros.', acceptedAnswers: ['71'] })).toBe(
      'Tiene ___ metros.',
    );
    expect(extractItemStem({ prompt: 'Explica el procedimiento.', levels: [] })).toBe(
      'Explica el procedimiento.',
    );
  });

  it('toma `passage` en lectura oral y `textWithGaps` en completar espacios', () => {
    expect(extractItemStem({ passage: 'Había una vez…' })).toBe('Había una vez…');
    expect(extractItemStem({ textWithGaps: 'El gato ___ sobre el tejado.' })).toBe(
      'El gato ___ sobre el tejado.',
    );
  });

  it('prefiere `stem` cuando conviven varias claves', () => {
    expect(extractItemStem({ stem: 'enunciado', prompt: 'instrucción' })).toBe('enunciado');
  });

  it('ignora los strings vacíos y sigue buscando', () => {
    expect(extractItemStem({ stem: '', prompt: 'instrucción' })).toBe('instrucción');
  });

  it('devuelve null cuando no hay ninguna clave textual', () => {
    expect(extractItemStem({ alternatives: [], correctAnswer: true })).toBeNull();
    expect(extractItemStem({})).toBeNull();
  });

  it('devuelve null ante contenido que no es un objeto', () => {
    expect(extractItemStem(null)).toBeNull();
    expect(extractItemStem(undefined)).toBeNull();
    expect(extractItemStem('enunciado suelto')).toBeNull();
  });
});

describe('extractItemStemPreview', () => {
  it('trunca con elipsis cuando excede el máximo', () => {
    expect(extractItemStemPreview({ prompt: 'abcdefghij' }, 4)).toBe('abcd…');
  });

  it('deja el enunciado intacto cuando cabe', () => {
    expect(extractItemStemPreview({ prompt: 'abcd' }, 4)).toBe('abcd');
  });

  it('propaga el null', () => {
    expect(extractItemStemPreview({}, 10)).toBeNull();
  });
});
