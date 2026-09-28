import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  TypeSafeError,
} from '@typesafe-ai/sdk';

import { DecisionError } from '../contracts';
import { choice, noul, score } from '../questions';
import {
  argmax,
  mapSdkError,
  parseSystemOneResponse,
  scoreProbabilitiesToArray,
  toSdkQuestions,
} from './jev-mapping';

const questions = {
  urgente: noul('¿Es urgente?'),
  area: choice('¿Qué área?', { billing: null, tech: 'Soporte técnico', sales: null }),
  calidad: score('¿Calidad?', ['mala', 'regular', 'buena']),
};

const okBody = {
  model: 'jev-1.13.0',
  answers: {
    urgente: { type: 'noul', noul: 0.95 },
    area: {
      type: 'choice',
      choice: 'billing',
      probabilities: { billing: 0.88, tech: 0.12 },
      confidence: 0.81,
    },
    calidad: {
      type: 'score',
      score: 1.2,
      legend: { '0': 'mala', '1': 'regular', '2': 'buena' },
      probabilities: { '0': 0.1, '1': 0.6, '2': 0.3 },
      confidence: 0.55,
    },
  },
  usage: { input_tokens: 318, output_tokens: 34 },
};

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof DecisionError ? error.code : 'otro-error';
  }
}

describe('toSdkQuestions', () => {
  it('traduce los tres tipos sin perder criterios', () => {
    expect(toSdkQuestions(questions)).toEqual({
      urgente: { type: 'noul', instructions: '¿Es urgente?' },
      area: {
        type: 'choice',
        instructions: '¿Qué área?',
        criteria: { billing: null, tech: 'Soporte técnico', sales: null },
      },
      calidad: { type: 'score', instructions: '¿Calidad?', criteria: ['mala', 'regular', 'buena'] },
    });
  });
});

describe('parseSystemOneResponse', () => {
  it('mapea noul, choice y score', () => {
    const parsed = parseSystemOneResponse(questions, okBody);

    expect(parsed.model).toBe('jev-1.13.0');
    expect(parsed.usage).toEqual({ inputTokens: 318, outputTokens: 34 });
    expect(parsed.answers.urgente).toEqual({ type: 'noul', probability: 0.95 });
    expect(parsed.answers.area).toEqual({
      type: 'choice',
      choice: 'billing',
      probabilities: { billing: 0.88, tech: 0.12, sales: 0 },
      confidence: 0.81,
    });
    expect(parsed.answers.calidad).toEqual({
      type: 'score',
      score: 1.2,
      level: 1,
      probabilities: [0.1, 0.6, 0.3],
      confidence: 0.55,
    });
  });

  it('en score con empate elige el nivel menor', () => {
    const body = {
      ...okBody,
      answers: {
        ...okBody.answers,
        calidad: {
          type: 'score',
          score: 1.5,
          probabilities: { '0': 0, '1': 0.5, '2': 0.5 },
          confidence: 0.1,
        },
      },
    };
    expect(parseSystemOneResponse(questions, body).answers.calidad.level).toBe(1);
  });

  it('lanza upstream si falta una respuesta, el tipo no coincide o la opción no existe', () => {
    const { urgente: _omitida, ...sinUrgente } = okBody.answers;
    expect(
      codeOf(() => parseSystemOneResponse(questions, { ...okBody, answers: sinUrgente })),
    ).toBe('upstream');

    const tipoCruzado = {
      ...okBody.answers,
      urgente: { type: 'choice', choice: 'x', probabilities: {}, confidence: 1 },
    };
    expect(
      codeOf(() => parseSystemOneResponse(questions, { ...okBody, answers: tipoCruzado })),
    ).toBe('upstream');

    const opcionInexistente = {
      ...okBody.answers,
      area: { ...okBody.answers.area, choice: 'marketing' },
    };
    expect(
      codeOf(() => parseSystemOneResponse(questions, { ...okBody, answers: opcionInexistente })),
    ).toBe('upstream');
  });

  it('lanza upstream ante un cuerpo mal formado', () => {
    expect(codeOf(() => parseSystemOneResponse(questions, 'texto'))).toBe('upstream');
    expect(codeOf(() => parseSystemOneResponse(questions, { ...okBody, model: undefined }))).toBe(
      'upstream',
    );
    expect(codeOf(() => parseSystemOneResponse(questions, { ...okBody, usage: {} }))).toBe(
      'upstream',
    );
    const noulTexto = { ...okBody.answers, urgente: { type: 'noul', noul: 'alto' } };
    expect(codeOf(() => parseSystemOneResponse(questions, { ...okBody, answers: noulTexto }))).toBe(
      'upstream',
    );
  });
});

describe('scoreProbabilitiesToArray / argmax', () => {
  it('convierte el mapa en arreglo por índice, con 0 en los niveles ausentes', () => {
    expect(scoreProbabilitiesToArray({ '0': 0.2, '2': 0.8 }, 3)).toEqual([0.2, 0, 0.8]);
    expect(scoreProbabilitiesToArray({ '1': 1, '7': 0.5, x: 0.1 }, 2)).toEqual([0, 1]);
  });

  it('argmax desempata hacia el índice menor', () => {
    expect(argmax([0.4, 0.4, 0.2])).toBe(0);
    expect(argmax([0.1, 0.45, 0.45])).toBe(1);
    expect(argmax([0, 0, 1])).toBe(2);
    expect(argmax([])).toBe(-1);
  });
});

describe('mapSdkError', () => {
  const fromStatus = (status: number): DecisionError =>
    mapSdkError(APIError.fromResponse(status, { error: 'x' }, new Headers()));

  it.each([
    [400, 'invalid_request'],
    [401, 'auth'],
    [403, 'auth'],
    [404, 'upstream'],
    [422, 'invalid_request'],
    [429, 'rate_limited'],
    [500, 'upstream'],
    [529, 'rate_limited'],
  ])('status %i → %s', (status, code) => {
    const mapped = fromStatus(status);
    expect(mapped.code).toBe(code);
    expect(mapped.cause).toBeInstanceOf(APIError);
  });

  it('traduce timeout, conexión, cancelación y errores genéricos', () => {
    expect(mapSdkError(new APITimeoutError(100)).code).toBe('timeout');
    expect(mapSdkError(new APIConnectionError()).code).toBe('upstream');
    expect(mapSdkError(new APIUserAbortError()).code).toBe('aborted');
    expect(mapSdkError(new TypeSafeError('config')).code).toBe('upstream');
    expect(mapSdkError(new Error('boom')).code).toBe('upstream');
    expect(mapSdkError('raro').code).toBe('upstream');
  });

  it('deja pasar un DecisionError tal cual', () => {
    const original = new DecisionError('context_exceeded', 'grande');
    expect(mapSdkError(original)).toBe(original);
  });
});
