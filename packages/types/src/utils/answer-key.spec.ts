import { deriveAnswerKey, isDevelopmentBucket, SCORE_CATEGORY_META } from './answer-key';

describe('deriveAnswerKey', () => {
  it('multiple_choice: deriva la clave correcta desde isCorrect', () => {
    const key = deriveAnswerKey('multiple_choice', {
      stem: '¿?',
      alternatives: [
        { key: 'A', text: 'a', isCorrect: false },
        { key: 'B', text: 'b', isCorrect: true },
      ],
    });
    expect(key).toEqual({
      kind: 'choice',
      correctKey: 'B',
      alternatives: [
        { key: 'A', text: 'a', isCorrect: false },
        { key: 'B', text: 'b', isCorrect: true },
      ],
    });
  });

  it('multiple_choice sin alternativas → none', () => {
    expect(deriveAnswerKey('multiple_choice', { stem: '¿?' })).toEqual({ kind: 'none' });
  });

  it('multi_select: lista todas las claves correctas', () => {
    const key = deriveAnswerKey('multi_select', {
      stem: '¿?',
      alternatives: [
        { key: 'A', text: 'a', isCorrect: true },
        { key: 'B', text: 'b', isCorrect: false },
        { key: 'C', text: 'c', isCorrect: true },
      ],
    });
    expect(key.kind).toBe('multi_choice');
    if (key.kind === 'multi_choice') {
      expect(key.correctKeys).toEqual(['A', 'C']);
    }
  });

  it('true_false: expone el booleano', () => {
    expect(deriveAnswerKey('true_false', { stem: '¿?', correctAnswer: false })).toEqual({
      kind: 'true_false',
      correctAnswer: false,
    });
  });

  it('short_answer: expone las respuestas aceptadas', () => {
    const key = deriveAnswerKey('short_answer', {
      prompt: '¿?',
      acceptedAnswers: ['21/10', '2,1'],
    });
    expect(key).toEqual({ kind: 'short_answer', acceptedAnswers: ['21/10', '2,1'] });
  });

  it('ordering: expone items y orden correcto', () => {
    const key = deriveAnswerKey('ordering', {
      items: [
        { id: '1', text: 'uno' },
        { id: '2', text: 'dos' },
      ],
      correctOrder: ['2', '1'],
    });
    expect(key.kind).toBe('ordering');
    if (key.kind === 'ordering') {
      expect(key.correctOrder).toEqual(['2', '1']);
      expect(key.items).toHaveLength(2);
    }
  });

  it('open_ended: respuesta modelo + rubricId', () => {
    const key = deriveAnswerKey('open_ended', {
      prompt: '¿?',
      sampleAnswer: 'una respuesta',
      rubricId: '11111111-1111-1111-1111-111111111111',
    });
    expect(key).toEqual({
      kind: 'sample_answer',
      sampleAnswer: 'una respuesta',
      rubricId: '11111111-1111-1111-1111-111111111111',
    });
  });

  it('writing sin sampleAnswer: sample_answer con null + rubricId', () => {
    const key = deriveAnswerKey('writing', {
      prompt: '¿?',
      rubricId: '22222222-2222-2222-2222-222222222222',
    });
    expect(key).toEqual({
      kind: 'sample_answer',
      sampleAnswer: null,
      rubricId: '22222222-2222-2222-2222-222222222222',
    });
  });

  it('rubric_scored: niveles + rubricId', () => {
    const key = deriveAnswerKey('rubric_scored', {
      prompt: '¿?',
      levels: [
        { code: '0', label: 'Insuficiente', creditFraction: 0 },
        { code: '2', descriptor: 'Logrado', creditFraction: 1 },
      ],
      rubricId: '33333333-3333-3333-3333-333333333333',
    });
    expect(key.kind).toBe('rubric_levels');
    if (key.kind === 'rubric_levels') {
      expect(key.levels).toEqual([
        { code: '0', label: 'Insuficiente', descriptor: null, creditFraction: 0 },
        { code: '2', label: null, descriptor: 'Logrado', creditFraction: 1 },
      ]);
      expect(key.rubricId).toBe('33333333-3333-3333-3333-333333333333');
    }
  });

  it('matching: columnas y pares correctos', () => {
    const key = deriveAnswerKey('matching', {
      leftItems: [{ id: 'l1', text: 'izq' }],
      rightItems: [
        { id: 'r1', text: 'der' },
        { id: 'r2', text: 'distractor' },
      ],
      correctPairs: [{ leftId: 'l1', rightId: 'r1' }],
    });
    expect(key.kind).toBe('matching');
    if (key.kind === 'matching') {
      expect(key.correctPairs).toEqual([{ leftId: 'l1', rightId: 'r1' }]);
      expect(key.rightItems).toHaveLength(2);
    }
  });

  it('content malformado no lanza', () => {
    expect(deriveAnswerKey('multiple_choice', null)).toEqual({ kind: 'none' });
    expect(deriveAnswerKey('short_answer', {})).toEqual({
      kind: 'short_answer',
      acceptedAnswers: [],
    });
  });
});

describe('categorías de puntaje de desarrollo', () => {
  it('isDevelopmentBucket reconoce RC/RPC/RI y descarta el resto', () => {
    expect(isDevelopmentBucket('RC')).toBe(true);
    expect(isDevelopmentBucket('RPC')).toBe(true);
    expect(isDevelopmentBucket('RI')).toBe(true);
    expect(isDevelopmentBucket('A')).toBe(false);
    expect(isDevelopmentBucket(null)).toBe(false);
  });

  it('SCORE_CATEGORY_META mapea crédito por categoría', () => {
    expect(SCORE_CATEGORY_META.RC.credit).toBe(1);
    expect(SCORE_CATEGORY_META.RPC.credit).toBe(0.5);
    expect(SCORE_CATEGORY_META.RI.credit).toBe(0);
  });
});
