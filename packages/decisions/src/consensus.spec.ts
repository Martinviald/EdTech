import type { ChoiceAnswer, PairThresholds } from './contracts';
import { pairConsensus, type PairSide } from './consensus';

const OPTIONS = ['A', 'B', 'C', 'D', 'blank', 'null'];
const JEV: PairThresholds = { agree: 0.6, solo: 0.85, unsure: 0.5 };
const OPENAI: PairThresholds = { agree: 0.5, solo: 0.8, unsure: 0.5 };

function ok(choice: string, confidence: number): PairSide {
  const answer: ChoiceAnswer<string> = {
    type: 'choice',
    choice,
    confidence,
    probabilities: { [choice]: confidence },
  };
  return { status: 'ok', answer };
}

const consensus = (a: PairSide, b: PairSide) => pairConsensus(a, b, JEV, OPENAI, OPTIONS);

describe('pairConsensus', () => {
  it('fila 1: si un motor falla va a revisión aunque el otro esté muy seguro', () => {
    expect(consensus({ status: 'failed', code: 'timeout' }, ok('B', 0.99))).toEqual({
      verdict: 'engine_failed',
      route: 'review',
      choice: null,
    });
    expect(consensus(ok('B', 0.99), { status: 'failed', code: 'dropped' }).verdict).toBe(
      'engine_failed',
    );
    expect(consensus(ok('B', 0.99), { status: 'failed', code: 'refused' }).route).toBe('review');
  });

  it('fila 2: una opción fuera de options o una confianza inválida es falla de motor', () => {
    expect(consensus(ok('E', 0.99), ok('E', 0.99)).verdict).toBe('engine_failed');
    expect(consensus(ok('B', Number.NaN), ok('B', 0.9)).verdict).toBe('engine_failed');
    expect(consensus(ok('B', 1.2), ok('B', 0.9)).verdict).toBe('engine_failed');
    expect(consensus(ok('B', 0.9), ok('B', -0.1)).verdict).toBe('engine_failed');
  });

  it('fila 3: coinciden y ambos superan su umbral de acuerdo → automática', () => {
    expect(consensus(ok('B', 0.6), ok('B', 0.5))).toEqual({
      verdict: 'agree',
      route: 'auto',
      choice: 'B',
    });
    expect(consensus(ok('blank', 0.95), ok('blank', 0.99)).choice).toBe('blank');
  });

  it('fila 4: coinciden pero alguno queda bajo su umbral de acuerdo → revisión', () => {
    expect(consensus(ok('B', 0.59), ok('B', 0.99)).verdict).toBe('low_agreement');
    expect(consensus(ok('B', 0.99), ok('B', 0.49)).verdict).toBe('low_agreement');
  });

  it('fila 5: difieren, A supera su solo y B no sabe → se acepta A', () => {
    expect(consensus(ok('null', 0.85), ok('B', 0.49))).toEqual({
      verdict: 'solo_a',
      route: 'auto',
      choice: 'null',
    });
  });

  it('fila 6: difieren, B supera su solo y A no sabe → se acepta B', () => {
    expect(consensus(ok('A', 0.49), ok('C', 0.8))).toEqual({
      verdict: 'solo_b',
      route: 'auto',
      choice: 'C',
    });
  });

  it('fila 7: difieren en cualquier otro caso → conflicto', () => {
    expect(consensus(ok('null', 0.83), ok('B', 0.46)).verdict).toBe('conflict');
    expect(consensus(ok('A', 0.95), ok('B', 0.95)).verdict).toBe('conflict');
    expect(consensus(ok('A', 0.7), ok('B', 0.6)).verdict).toBe('conflict');
  });

  it('bordes: unsure es estricto (la confianza igual al umbral no cuenta como "no sabe")', () => {
    expect(consensus(ok('A', 0.9), ok('B', 0.5)).verdict).toBe('conflict');
    expect(consensus(ok('A', 0.5), ok('B', 0.9)).verdict).toBe('conflict');
    expect(consensus(ok('A', 0.84999), ok('B', 0.1)).verdict).toBe('conflict');
    expect(consensus(ok('A', 0.1), ok('B', 0.79999)).verdict).toBe('conflict');
  });

  it('nunca acepta solo_a y solo_b a la vez porque unsure <= solo', () => {
    expect(consensus(ok('A', 0.9), ok('B', 0.9)).verdict).toBe('conflict');
  });

  it('lanza invalid_request si los umbrales violan la invariante', () => {
    const invalid: PairThresholds = { agree: 0.9, solo: 0.8, unsure: 0.5 };
    expect(() => pairConsensus(ok('A', 1), ok('A', 1), invalid, OPENAI, OPTIONS)).toThrow(
      expect.objectContaining({ code: 'invalid_request' }),
    );
    expect(() =>
      pairConsensus(ok('A', 1), ok('A', 1), JEV, { agree: 0.5, solo: 0.8, unsure: 0.6 }, OPTIONS),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      pairConsensus(ok('A', 1), ok('A', 1), JEV, { agree: 0.5, solo: 1.1, unsure: 0 }, OPTIONS),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
  });
});
