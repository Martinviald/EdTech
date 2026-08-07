import {
  buildRawAnswerDistribution,
  supportsRawAnswerDistribution,
} from './raw-answer-distribution';

describe('supportsRawAnswerDistribution', () => {
  it('aplica a tipos estructurados no-MC', () => {
    expect(supportsRawAnswerDistribution('short_answer')).toBe(true);
    expect(supportsRawAnswerDistribution('ordering')).toBe(true);
    expect(supportsRawAnswerDistribution('matching')).toBe(true);
    expect(supportsRawAnswerDistribution('gap_fill')).toBe(true);
  });
  it('no aplica a MC ni a desarrollo de texto', () => {
    expect(supportsRawAnswerDistribution('multiple_choice')).toBe(false);
    expect(supportsRawAnswerDistribution('open_ended')).toBe(false);
    expect(supportsRawAnswerDistribution('rubric_scored')).toBe(false);
  });
});

describe('buildRawAnswerDistribution', () => {
  it('short_answer: agrupa por valor exacto y ordena por frecuencia', () => {
    const dist = buildRawAnswerDistribution('short_answer', {}, [
      { value: { raw: '24' }, isCorrect: false },
      { value: { raw: '24' }, isCorrect: false },
      { value: { answer: '21/10' }, isCorrect: true },
      { value: { raw: '24' }, isCorrect: false },
      { value: null, isCorrect: null },
    ]);
    expect(dist).toEqual([
      { answer: '24', count: 3, isCorrect: false, percentage: 75 },
      { answer: '21/10', count: 1, isCorrect: true, percentage: 25 },
    ]);
  });

  it('short_answer: sin respuestas con valor → lista vacía', () => {
    expect(
      buildRawAnswerDistribution('short_answer', {}, [{ value: {}, isCorrect: null }]),
    ).toEqual([]);
  });

  it('ordering: mapea ids al texto de los items y los une con flechas', () => {
    const content = {
      items: [
        { id: 'a', text: 'Uno' },
        { id: 'b', text: 'Dos' },
        { id: 'c', text: 'Tres' },
      ],
    };
    const dist = buildRawAnswerDistribution('ordering', content, [
      { value: { answer: ['b', 'a', 'c'] }, isCorrect: false },
      { value: { answer: ['b', 'a', 'c'] }, isCorrect: false },
      { value: { answer: ['a', 'b', 'c'] }, isCorrect: true },
    ]);
    expect(dist[0]).toMatchObject({ answer: 'Dos → Uno → Tres', count: 2, isCorrect: false });
    expect(dist[0].percentage).toBeCloseTo(66.67, 1);
    expect(dist[1]).toMatchObject({ answer: 'Uno → Dos → Tres', count: 1, isCorrect: true });
    expect(dist[1].percentage).toBeCloseTo(33.33, 1);
  });

  it('matching: renderiza pares con etiquetas legibles', () => {
    const content = {
      leftItems: [
        { id: 'l1', text: 'León' },
        { id: 'l2', text: 'Águila' },
      ],
      rightItems: [
        { id: 'r1', text: 'Mamífero' },
        { id: 'r2', text: 'Ave' },
      ],
    };
    const dist = buildRawAnswerDistribution('matching', content, [
      { value: { answer: { l1: 'r2', l2: 'r1' } }, isCorrect: false },
    ]);
    expect(dist[0].answer).toBe('León → Ave · Águila → Mamífero');
    expect(dist[0].isCorrect).toBe(false);
  });

  it('agrupa el excedente en un bucket "Otras"', () => {
    const responses = Array.from({ length: 15 }, (_, i) => ({
      value: { raw: `v${i}` },
      isCorrect: false,
    }));
    const dist = buildRawAnswerDistribution('short_answer', {}, responses, 12);
    expect(dist).toHaveLength(13);
    expect(dist[12].answer).toBe('Otras (3 respuestas distintas)');
    expect(dist[12].count).toBe(3);
  });
});
