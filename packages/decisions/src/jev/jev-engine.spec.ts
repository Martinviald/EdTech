import { APIConnectionError, APIUserAbortError, AuthenticationError } from '@typesafe-ai/sdk';

import { DecisionError } from '../contracts';
import { choice, noul, score } from '../questions';
import {
  JEV_API_KEY_ENV,
  JEV_DEFAULT_MODEL,
  JevDecisionEngine,
  type JevEngineConfig,
} from './jev-engine';

const questions = {
  urgente: noul('¿Es urgente?'),
  area: choice('¿Qué área?', { billing: null, tech: null }),
  calidad: score('¿Calidad?', ['mala', 'buena']),
};

const okBody = {
  model: 'jev-1.13.0',
  answers: {
    urgente: { type: 'noul', noul: 0.95 },
    area: {
      type: 'choice',
      choice: 'tech',
      probabilities: { billing: 0.2, tech: 0.8 },
      confidence: 0.6,
    },
    calidad: {
      type: 'score',
      score: 0.7,
      legend: { '0': 'mala', '1': 'buena' },
      probabilities: { '0': 0.3, '1': 0.7 },
      confidence: 0.4,
    },
  },
  usage: { input_tokens: 296, output_tokens: 20 },
};

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** `fetch` falso que devuelve las respuestas en orden (la última se repite). */
function fetchReturning(...responses: (() => Response)[]) {
  let call = 0;
  return jest.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    if (next === undefined) throw new Error('fetchReturning sin respuestas');
    return next();
  });
}

/** `fetch` falso que nunca responde: solo termina cuando el SDK aborta. */
function hangingFetch() {
  return jest.fn(
    (_url: string, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new Error('abortado'));
          return;
        }
        signal?.addEventListener('abort', () => reject(new Error('abortado')));
      }),
  );
}

function engineWith(
  fetch: JevEngineConfig['fetch'],
  extra: Partial<JevEngineConfig> = {},
): JevDecisionEngine {
  return new JevDecisionEngine({ apiKey: 'test-key', fetch, maxRetries: 0, ...extra });
}

function firstCall(
  mock: jest.Mock<Promise<Response>, [string, RequestInit?]>,
): [string, RequestInit | undefined] {
  const call = mock.mock.calls[0];
  if (call === undefined) throw new Error('fetch no fue llamado');
  return [call[0], call[1]];
}

describe('JevDecisionEngine', () => {
  const savedKey = process.env[JEV_API_KEY_ENV];
  afterEach(() => {
    if (savedKey === undefined) delete process.env[JEV_API_KEY_ENV];
    else process.env[JEV_API_KEY_ENV] = savedKey;
  });

  it('evalúa, mapea las respuestas y usa el modelo fijado por defecto', async () => {
    const fetch = fetchReturning(() => jsonResponse(200, okBody));
    const engine = engineWith(fetch);

    const result = await engine.evaluate({ state: 'me cobraron dos veces', questions });
    const area: 'billing' | 'tech' = result.answers.area.choice;

    expect(engine.name).toBe('jev');
    expect(result.engine).toBe('jev');
    expect(result.model).toBe('jev-1.13.0');
    expect(result.usage).toEqual({ inputTokens: 296, outputTokens: 20 });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.answers.urgente.probability).toBe(0.95);
    expect(area).toBe('tech');
    expect(result.answers.calidad).toEqual({
      type: 'score',
      score: 0.7,
      level: 1,
      probabilities: [0.3, 0.7],
      confidence: 0.4,
    });

    const [url, init] = firstCall(fetch);
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    const sent: unknown = JSON.parse(String(init?.body));
    expect(sent).toMatchObject({
      model: JEV_DEFAULT_MODEL,
      state: 'me cobraron dos veces',
      questions: { calidad: { type: 'score', criteria: ['mala', 'buena'] } },
    });
  });

  it('devuelve el modelo que informa la API aunque se pida un alias', async () => {
    const fetch = fetchReturning(() => jsonResponse(200, { ...okBody, model: 'jev-1.13.2' }));
    const result = await engineWith(fetch, { baseURL: 'https://jev.test/' }).evaluate({
      state: 's',
      questions,
      model: 'jev-latest',
    });

    const [url, init] = firstCall(fetch);
    expect(url).toBe('https://jev.test/v1/systemone');
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'jev-latest' });
    expect(result.model).toBe('jev-1.13.2');
  });

  it('lanza upstream si la respuesta no trae todas las preguntas', async () => {
    const { calidad: _omitida, ...incompletas } = okBody.answers;
    const fetch = fetchReturning(() => jsonResponse(200, { ...okBody, answers: incompletas }));
    await expect(engineWith(fetch).evaluate({ state: 's', questions })).rejects.toMatchObject({
      code: 'upstream',
    });
  });

  it.each([
    [400, 'invalid_request'],
    [401, 'auth'],
    [403, 'auth'],
    [422, 'invalid_request'],
    [429, 'rate_limited'],
    [500, 'upstream'],
    [529, 'rate_limited'],
  ])('traduce el status %i a %s', async (status, code) => {
    const fetch = fetchReturning(() =>
      jsonResponse(status, { error: { message: 'falla simulada' } }),
    );
    const error: unknown = await engineWith(fetch)
      .evaluate({ state: 's', questions })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DecisionError);
    expect(error).toMatchObject({ code });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('conserva el error del SDK en cause', async () => {
    const fetch = fetchReturning(() => jsonResponse(401, { error: 'bad key' }));
    const error: unknown = await engineWith(fetch)
      .evaluate({ state: 's', questions })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DecisionError);
    expect(error instanceof DecisionError && error.cause).toBeInstanceOf(AuthenticationError);
  });

  it('reintenta un 529 y luego responde', async () => {
    const fetch = fetchReturning(
      () => jsonResponse(529, { error: 'overloaded' }, { 'retry-after-ms': '0' }),
      () => jsonResponse(200, okBody),
    );
    const result = await engineWith(fetch, { maxRetries: 1 }).evaluate({ state: 's', questions });
    expect(result.answers.urgente.probability).toBe(0.95);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('traduce un timeout', async () => {
    const fetch = hangingFetch();
    await expect(
      engineWith(fetch, { timeoutMs: 20 }).evaluate({ state: 's', questions }),
    ).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('respeta el timeoutMs del request', async () => {
    const fetch = hangingFetch();
    await expect(
      engineWith(fetch).evaluate({ state: 's', questions, timeoutMs: 20 }),
    ).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('traduce un error de conexión a upstream', async () => {
    const fetch = jest.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
      throw new TypeError('fetch failed');
    });
    const error: unknown = await engineWith(fetch)
      .evaluate({ state: 's', questions })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'upstream' });
    expect(error instanceof DecisionError && error.cause).toBeInstanceOf(APIConnectionError);
  });

  it('pasa el signal al SDK: una cancelación sale como aborted', async () => {
    const fetch = hangingFetch();
    const controller = new AbortController();
    controller.abort();
    const error: unknown = await engineWith(fetch)
      .evaluate({ state: 's', questions, signal: controller.signal })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'aborted' });
    expect(error instanceof DecisionError && error.cause).toBeInstanceOf(APIUserAbortError);
  });

  it('sin API key no está disponible y lanza unavailable sin tocar la red', async () => {
    delete process.env[JEV_API_KEY_ENV];
    const fetch = fetchReturning(() => jsonResponse(200, okBody));
    const engine = new JevDecisionEngine({ fetch });

    expect(engine.isAvailable()).toBe(false);
    await expect(engine.evaluate({ state: 's', questions })).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('toma la API key de TYPESAFE_API_KEY', async () => {
    process.env[JEV_API_KEY_ENV] = 'desde-env';
    const fetch = fetchReturning(() => jsonResponse(200, okBody));
    const engine = new JevDecisionEngine({ fetch, maxRetries: 0 });

    expect(engine.isAvailable()).toBe(true);
    await engine.evaluate({ state: 's', questions });
    const [, init] = firstCall(fetch);
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer desde-env' });
  });

  it('valida los límites antes de la red', async () => {
    const fetch = fetchReturning(() => jsonResponse(200, okBody));
    const engine = engineWith(fetch);

    await expect(engine.evaluate({ state: 's', questions: {} })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(
      engine.evaluate({ state: 's', questions: { q: score('?', ['uno']) } }),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(engine.evaluate({ state: 'x'.repeat(100_000), questions })).rejects.toMatchObject({
      code: 'context_exceeded',
    });
    await expect(engine.evaluate({ state: 's', questions, timeoutMs: 0 })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
