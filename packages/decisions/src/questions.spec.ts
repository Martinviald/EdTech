import {
  DECISION_LIMITS,
  DecisionError,
  type DecisionErrorCode,
  type DecisionQuestions,
} from './contracts';
import {
  assertWithinLimits,
  choice,
  estimateTokens,
  noul,
  score,
  validateQuestions,
} from './questions';

function errorCode(fn: () => unknown): DecisionErrorCode | 'no-lanzó' | 'otro-error' {
  try {
    fn();
  } catch (error) {
    return error instanceof DecisionError ? error.code : 'otro-error';
  }
  return 'no-lanzó';
}

function options(n: number): Record<string, null> {
  const out: Record<string, null> = {};
  for (let i = 0; i < n; i += 1) out[`o${i}`] = null;
  return out;
}

function levels(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `nivel ${i}`);
}

describe('constructores', () => {
  it('noul sin criterios no agrega la clave criteria', () => {
    expect(noul('¿Es urgente?')).toEqual({ type: 'noul', instructions: '¿Es urgente?' });
    expect(noul('¿Es urgente?', { true: 'sí', false: 'no' })).toEqual({
      type: 'noul',
      instructions: '¿Es urgente?',
      criteria: { true: 'sí', false: 'no' },
    });
  });

  it('choice preserva las claves literales y acepta criterios dinámicos', () => {
    const q = choice('¿Área?', { billing: null, tech: 'Soporte técnico' });
    const keys: (keyof typeof q.criteria)[] = ['billing', 'tech'];
    // @ts-expect-error: 'otra' no es una opción de la pregunta.
    const invalidKey: keyof typeof q.criteria = 'otra';
    expect(Object.keys(q.criteria)).toEqual(keys);
    expect(invalidKey).toBe('otra');

    const dynamic: Record<string, string> = { A: 'uno', B: 'dos' };
    const d = choice('¿Cuál?', dynamic);
    expect(d).toEqual({ type: 'choice', instructions: '¿Cuál?', criteria: { A: 'uno', B: 'dos' } });
  });

  it('score guarda los niveles como criteria', () => {
    expect(score('¿Calidad?', ['mala', 'buena'])).toEqual({
      type: 'score',
      instructions: '¿Calidad?',
      criteria: ['mala', 'buena'],
    });
  });
});

describe('validateQuestions', () => {
  it('exige al menos una pregunta', () => {
    expect(errorCode(() => validateQuestions({}))).toBe('invalid_request');
  });

  it('acepta 1 y 255 opciones; rechaza 0 y 256', () => {
    expect(errorCode(() => validateQuestions({ q: choice('?', options(1)) }))).toBe('no-lanzó');
    expect(errorCode(() => validateQuestions({ q: choice('?', options(255)) }))).toBe('no-lanzó');
    expect(errorCode(() => validateQuestions({ q: choice('?', options(0)) }))).toBe(
      'invalid_request',
    );
    expect(errorCode(() => validateQuestions({ q: choice('?', options(256)) }))).toBe(
      'invalid_request',
    );
  });

  it('acepta 2 y 10 niveles; rechaza 1 y 11', () => {
    expect(errorCode(() => validateQuestions({ q: score('?', levels(2)) }))).toBe('no-lanzó');
    expect(errorCode(() => validateQuestions({ q: score('?', levels(10)) }))).toBe('no-lanzó');
    expect(errorCode(() => validateQuestions({ q: score('?', levels(1)) }))).toBe(
      'invalid_request',
    );
    expect(errorCode(() => validateQuestions({ q: score('?', levels(11)) }))).toBe(
      'invalid_request',
    );
  });

  it('rechaza un tipo desconocido llegado desde JSON', () => {
    const raw: unknown = JSON.parse('{"q":{"type":"rank","instructions":"?"}}');
    expect(errorCode(() => validateQuestions(raw as DecisionQuestions))).toBe('invalid_request');
  });
});

describe('estimateTokens', () => {
  it('divide el largo del JSON por charsPerToken y redondea hacia arriba', () => {
    expect(estimateTokens('abc')).toBe(Math.ceil(5 / DECISION_LIMITS.charsPerToken));
    expect(estimateTokens({ a: 1 })).toBe(Math.ceil(7 / DECISION_LIMITS.charsPerToken));
    expect(estimateTokens(undefined)).toBe(0);
  });
});

describe('assertWithinLimits', () => {
  const small = { q: noul('¿Sí?') };

  it('deja pasar un request normal', () => {
    expect(errorCode(() => assertWithinLimits('estado', small))).toBe('no-lanzó');
  });

  it('rechaza cero preguntas antes de medir el contexto', () => {
    expect(errorCode(() => assertWithinLimits('estado', {}))).toBe('invalid_request');
  });

  it('rechaza un estado que por sí solo excede los 32k tokens', () => {
    const chars = DECISION_LIMITS.maxStatePlusQuestionTokens * DECISION_LIMITS.charsPerToken;
    expect(errorCode(() => assertWithinLimits('x'.repeat(chars), small))).toBe('context_exceeded');
  });

  it('rechaza cuando el total supera 64k aunque cada pregunta quepa sola', () => {
    const big = 'y'.repeat(70_000);
    const questions = { a: noul(big), b: noul(big), c: noul(big) };
    expect(estimateTokens({ a: questions.a })).toBeLessThan(
      DECISION_LIMITS.maxStatePlusQuestionTokens,
    );
    expect(errorCode(() => assertWithinLimits('estado', questions))).toBe('context_exceeded');
  });
});
