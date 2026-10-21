import { DecisionError, type DecisionErrorCode, type DecisionQuestions } from './contracts';
import { JEV_LIMITS } from './jev/jev-limits';
import { OPENAI_LIMITS } from './openai/openai-limits';
import {
  assertImagesSupported,
  assertValidTimeout,
  assertWithinLimits,
  choice,
  estimateTokens,
  noul,
  score,
  validateImages,
  validateQuestions,
} from './questions';

const L = JEV_LIMITS;

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
    expect(errorCode(() => validateQuestions({}, L))).toBe('invalid_request');
  });

  it('acepta 1 y 255 opciones; rechaza 0 y 256', () => {
    expect(errorCode(() => validateQuestions({ q: choice('?', options(1)) }, L))).toBe('no-lanzó');
    expect(errorCode(() => validateQuestions({ q: choice('?', options(255)) }, L))).toBe(
      'no-lanzó',
    );
    expect(errorCode(() => validateQuestions({ q: choice('?', options(0)) }, L))).toBe(
      'invalid_request',
    );
    expect(errorCode(() => validateQuestions({ q: choice('?', options(256)) }, L))).toBe(
      'invalid_request',
    );
  });

  it('acepta 2 y 10 niveles; rechaza 1 y 11', () => {
    expect(errorCode(() => validateQuestions({ q: score('?', levels(2)) }, L))).toBe('no-lanzó');
    expect(errorCode(() => validateQuestions({ q: score('?', levels(10)) }, L))).toBe('no-lanzó');
    expect(errorCode(() => validateQuestions({ q: score('?', levels(1)) }, L))).toBe(
      'invalid_request',
    );
    expect(errorCode(() => validateQuestions({ q: score('?', levels(11)) }, L))).toBe(
      'invalid_request',
    );
  });

  it('rechaza un tipo desconocido llegado desde JSON', () => {
    const raw: unknown = JSON.parse('{"q":{"type":"rank","instructions":"?"}}');
    expect(errorCode(() => validateQuestions(raw as DecisionQuestions, L))).toBe('invalid_request');
  });
});

describe('estimateTokens', () => {
  it('divide el largo del JSON por charsPerToken y redondea hacia arriba', () => {
    expect(estimateTokens('abc', L.charsPerToken)).toBe(Math.ceil(5 / L.charsPerToken));
    expect(estimateTokens({ a: 1 }, L.charsPerToken)).toBe(Math.ceil(7 / L.charsPerToken));
    expect(estimateTokens(undefined, L.charsPerToken)).toBe(0);
  });
});

describe('assertWithinLimits', () => {
  const small = { q: noul('¿Sí?') };

  it('deja pasar un request normal', () => {
    expect(errorCode(() => assertWithinLimits('estado', small, L))).toBe('no-lanzó');
  });

  it('rechaza cero preguntas antes de medir el contexto', () => {
    expect(errorCode(() => assertWithinLimits('estado', {}, L))).toBe('invalid_request');
  });

  it('rechaza un estado que por sí solo excede los 32k tokens', () => {
    const chars = L.maxStatePlusQuestionTokens * L.charsPerToken;
    expect(errorCode(() => assertWithinLimits('x'.repeat(chars), small, L))).toBe(
      'context_exceeded',
    );
  });

  it('rechaza cuando el total supera 64k aunque cada pregunta quepa sola', () => {
    const big = 'y'.repeat(70_000);
    const questions = { a: noul(big), b: noul(big), c: noul(big) };
    expect(estimateTokens({ a: questions.a }, L.charsPerToken)).toBeLessThan(
      L.maxStatePlusQuestionTokens,
    );
    expect(errorCode(() => assertWithinLimits('estado', questions, L))).toBe('context_exceeded');
  });
});

describe('límites por motor', () => {
  it('OpenAI exige al menos 2 opciones en choice; Jev acepta 1', () => {
    const q = { q: choice('?', options(1)) };
    expect(errorCode(() => validateQuestions(q, JEV_LIMITS))).toBe('no-lanzó');
    expect(errorCode(() => validateQuestions(q, OPENAI_LIMITS))).toBe('invalid_request');
  });

  it('un estado que excede a Jev cabe en OpenAI', () => {
    const state = 'x'.repeat(JEV_LIMITS.maxRequestTokens * JEV_LIMITS.charsPerToken);
    const small = { q: noul('¿Sí?') };
    expect(errorCode(() => assertWithinLimits(state, small, JEV_LIMITS))).toBe('context_exceeded');
    expect(errorCode(() => assertWithinLimits(state, small, OPENAI_LIMITS))).toBe('no-lanzó');
  });

  it('cada imagen cuenta tokensPerImage dentro del estado', () => {
    const small = { q: noul('¿Sí?') };
    const image = { url: 'https://example.com/figura.png' };
    const fits = Math.floor(OPENAI_LIMITS.maxRequestTokens / OPENAI_LIMITS.tokensPerImage) - 1;
    expect(
      errorCode(() =>
        assertWithinLimits('estado', small, OPENAI_LIMITS, new Array(fits).fill(image)),
      ),
    ).toBe('no-lanzó');
    expect(
      errorCode(() =>
        assertWithinLimits('estado', small, OPENAI_LIMITS, new Array(fits + 2).fill(image)),
      ),
    ).toBe('context_exceeded');
  });
});

describe('validateImages', () => {
  it('acepta bytes base64 con mimeType de imagen y URLs http(s)', () => {
    expect(
      errorCode(() =>
        validateImages([
          { mimeType: 'image/png', data: 'iVBORw0KGgo=' },
          { url: 'https://example.com/a.png' },
          { url: 'http://example.com/b.jpg?firma=1' },
        ]),
      ),
    ).toBe('no-lanzó');
  });

  it('rechaza URLs no http(s), mimeType que no es imagen y data URLs en data', () => {
    expect(errorCode(() => validateImages([{ url: 'file:///etc/passwd' }]))).toBe(
      'invalid_request',
    );
    expect(errorCode(() => validateImages([{ url: 'no es url' }]))).toBe('invalid_request');
    expect(errorCode(() => validateImages([{ mimeType: 'application/pdf', data: 'abc' }]))).toBe(
      'invalid_request',
    );
    expect(
      errorCode(() =>
        validateImages([{ mimeType: 'image/png', data: 'data:image/png;base64,abc' }]),
      ),
    ).toBe('invalid_request');
    expect(errorCode(() => validateImages([{ mimeType: 'image/png', data: '' }]))).toBe(
      'invalid_request',
    );
  });
});

describe('assertImagesSupported', () => {
  const textOnly = { name: 'solo-texto', capabilities: { images: false } };
  const multimodal = { name: 'multimodal', capabilities: { images: true } };
  const images = [{ url: 'https://example.com/a.png' }];

  it('rechaza imágenes en un motor sin capabilities.images', () => {
    expect(errorCode(() => assertImagesSupported(textOnly, images))).toBe('invalid_request');
  });

  it('deja pasar sin imágenes o en un motor que las acepta', () => {
    expect(errorCode(() => assertImagesSupported(textOnly, undefined))).toBe('no-lanzó');
    expect(errorCode(() => assertImagesSupported(textOnly, []))).toBe('no-lanzó');
    expect(errorCode(() => assertImagesSupported(multimodal, images))).toBe('no-lanzó');
  });
});

describe('assertValidTimeout', () => {
  it('acepta undefined y positivos; rechaza 0, negativos y NaN', () => {
    expect(errorCode(() => assertValidTimeout(undefined))).toBe('no-lanzó');
    expect(errorCode(() => assertValidTimeout(500))).toBe('no-lanzó');
    expect(errorCode(() => assertValidTimeout(0))).toBe('invalid_request');
    expect(errorCode(() => assertValidTimeout(-1))).toBe('invalid_request');
    expect(errorCode(() => assertValidTimeout(Number.NaN))).toBe('invalid_request');
  });
});
