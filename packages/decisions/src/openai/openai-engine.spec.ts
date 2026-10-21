import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DecisionError } from '../contracts';
import { choice, noul, score } from '../questions';
import {
  OPENAI_API_KEY_ENV,
  OPENAI_DECISIONS_DEFAULT_MODEL,
  OpenAiDecisionEngine,
  type OpenAiEngineConfig,
} from './openai-engine';
import { OPENAI_LIMITS } from './openai-limits';

function fixture(name: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'));
  return parsed;
}

function errorFixture(name: string): { status: number; body: unknown } {
  const raw = fixture(name);
  if (typeof raw !== 'object' || raw === null || !('status' in raw) || !('body' in raw)) {
    throw new Error(`fixture de error inválido: ${name}`);
  }
  const { status, body } = raw;
  if (typeof status !== 'number') throw new Error(`status inválido en ${name}`);
  return { status, body };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(name: string): Response {
  const { status, body } = errorFixture(name);
  return jsonResponse(status, { error: body });
}

function fetchReturning(...responses: (() => Response)[]) {
  let call = 0;
  return jest.fn(async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    if (next === undefined) throw new Error('fetchReturning sin respuestas');
    return next();
  });
}

function abortError(): Error {
  const error = new Error('abortado');
  error.name = 'AbortError';
  return error;
}

function hangingFetch() {
  return jest.fn(
    (_url: string | URL | Request, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        signal?.addEventListener('abort', () => reject(abortError()));
      }),
  );
}

function engineWith(
  fetch: OpenAiEngineConfig['fetch'],
  extra: Partial<OpenAiEngineConfig> = {},
): OpenAiDecisionEngine {
  return new OpenAiDecisionEngine({ apiKey: 'test-key', fetch, maxRetries: 0, ...extra });
}

function firstCall(mock: jest.Mock<Promise<Response>, [string | URL | Request, RequestInit?]>): {
  url: string;
  init: RequestInit | undefined;
  body: unknown;
} {
  const call = mock.mock.calls[0];
  if (call === undefined) throw new Error('fetch no fue llamado');
  const [input, init] = call;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const body: unknown = init?.body === undefined ? undefined : JSON.parse(String(init.body));
  return { url, init, body };
}

const judgeQuestions = {
  clave: choice('¿Cuál es la clave?', { A: null, B: null, C: null, D: null }),
  respuesta_unica: noul('¿Tiene una única respuesta correcta?'),
  dificultad: score('¿Qué tan difícil es?', ['baja', 'media', 'alta']),
};

const okFetch = () => fetchReturning(() => jsonResponse(200, fixture('texto_juez.json')));

describe('OpenAiDecisionEngine', () => {
  const savedKey = process.env[OPENAI_API_KEY_ENV];
  afterEach(() => {
    if (savedKey === undefined) delete process.env[OPENAI_API_KEY_ENV];
    else process.env[OPENAI_API_KEY_ENV] = savedKey;
  });

  it('declara su nombre, capacidades y límites', () => {
    const engine = engineWith(okFetch());
    expect(engine.name).toBe('openai');
    expect(engine.capabilities.images).toBe(true);
    expect(engine.limits).toBe(OPENAI_LIMITS);
  });

  it('arma un request bien formado', async () => {
    const fetch = okFetch();
    await engineWith(fetch).evaluate({ state: 'enunciado del ítem', questions: judgeQuestions });

    const { url, init, body } = firstCall(fetch);
    expect(url.endsWith('/decisions')).toBe(true);
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key');
    expect(init?.method).toBe('POST');
    expect(body).toMatchObject({
      model: 'gpt-6-luna',
      input: 'enunciado del ítem',
      questions: [
        { type: 'choice', name: 'clave' },
        { type: 'predicate', name: 'respuesta_unica' },
        { type: 'score', name: 'dificultad' },
      ],
    });
    expect(OPENAI_DECISIONS_DEFAULT_MODEL).toBe('gpt-6-luna');
  });

  it('mapea la respuesta grabada a answers tipadas, model y usage', async () => {
    const result = await engineWith(okFetch()).evaluate({
      state: 'enunciado',
      questions: judgeQuestions,
    });
    const clave: 'A' | 'B' | 'C' | 'D' = result.answers.clave.choice;

    expect(result.engine).toBe('openai');
    expect(result.model).toBe('gpt-6-luna');
    expect(result.usage).toEqual({ inputTokens: 498, outputTokens: 0 });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(clave).toBe('B');
    expect(result.answers.respuesta_unica.probability).toBe(1);
    expect(result.answers.dificultad).toMatchObject({ level: 0, score: 0.01 });
  });

  it('el model del request sobreescribe el default y el defaultModel de la config', async () => {
    const fetch = okFetch();
    await engineWith(fetch, { defaultModel: 'gpt-6-otro' }).evaluate({
      state: 's',
      questions: judgeQuestions,
      model: 'gpt-6-pedido',
    });
    expect(firstCall(fetch).body).toMatchObject({ model: 'gpt-6-pedido' });

    const fetch2 = okFetch();
    await engineWith(fetch2, { defaultModel: 'gpt-6-otro' }).evaluate({
      state: 's',
      questions: judgeQuestions,
    });
    expect(firstCall(fetch2).body).toMatchObject({ model: 'gpt-6-otro' });
  });

  it('las imágenes viajan en el body', async () => {
    const fetch = fetchReturning(() => jsonResponse(200, fixture('dos_imagenes.json')));
    const result = await engineWith(fetch).evaluate({
      state: 'mira los gráficos',
      images: [{ mimeType: 'image/png', data: 'QUJD' }, { url: 'https://cdn.test/g.png' }],
      questions: { hay_grafico: noul('¿Hay un gráfico?') },
    });

    expect(result.answers.hay_grafico.probability).toBe(1);
    expect(firstCall(fetch).body).toMatchObject({
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'mira los gráficos' },
            { type: 'input_image', image_url: 'data:image/png;base64,QUJD' },
            { type: 'input_image', image_url: 'https://cdn.test/g.png' },
          ],
        },
      ],
    });
  });

  describe('errores HTTP', () => {
    const request = { state: 's', questions: { q: noul('?') } };

    it.each([
      ['key_mala.error.json', 'auth'],
      ['choice_256.error.json', 'invalid_request'],
      ['choice_1.error.json', 'invalid_request'],
      ['score_11.error.json', 'invalid_request'],
      ['contexto_grande.error.json', 'context_exceeded'],
      ['modelo_malo.error.json', 'invalid_request'],
      ['imagen_url_404.error.json', 'invalid_request'],
      ['nombres_repetidos.error.json', 'invalid_request'],
    ])('%s → %s', async (file, code) => {
      const fetch = fetchReturning(() => errorResponse(file));
      const error: unknown = await engineWith(fetch)
        .evaluate(request)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DecisionError);
      expect(error).toMatchObject({ code });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('429 → rate_limited', async () => {
      const fetch = fetchReturning(() =>
        jsonResponse(429, { error: { message: 'Rate limit reached', type: 'requests' } }),
      );
      await expect(engineWith(fetch).evaluate(request)).rejects.toMatchObject({
        code: 'rate_limited',
      });
    });

    it('500 → upstream', async () => {
      const fetch = fetchReturning(() =>
        jsonResponse(500, { error: { message: 'The server had an error', type: 'server_error' } }),
      );
      await expect(engineWith(fetch).evaluate(request)).rejects.toMatchObject({
        code: 'upstream',
      });
    });

    it('un error de conexión → upstream', async () => {
      const fetch = jest.fn(async (): Promise<Response> => {
        throw new TypeError('fetch failed');
      });
      await expect(engineWith(fetch).evaluate(request)).rejects.toMatchObject({
        code: 'upstream',
      });
    });
  });

  it('lanza refused cuando el modelo se niega', async () => {
    const fetch = fetchReturning(() => jsonResponse(200, fixture('refusal.json')));
    const error: unknown = await engineWith(fetch)
      .evaluate({
        state: 's',
        questions: {
          instrucciones_completas: noul('?'),
          mejor_precursor: choice('?', { a: null, b: null }),
        },
      })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'refused' });
    expect(error instanceof Error && error.message).toContain('mejor_precursor');
  });

  it('lanza upstream si la respuesta no calza con las preguntas', async () => {
    const fetch = fetchReturning(() => jsonResponse(200, fixture('texto_juez.json')));
    await expect(
      engineWith(fetch).evaluate({ state: 's', questions: { otra: noul('?') } }),
    ).rejects.toMatchObject({ code: 'upstream' });
  });

  describe('validación previa (sin llamar a fetch)', () => {
    const cases: Array<[string, () => Parameters<OpenAiDecisionEngine['evaluate']>[0], string]> = [
      [
        'choice de 1 opción',
        () => ({ state: 's', questions: { q: choice('?', { a: null }) } }),
        'invalid_request',
      ],
      [
        '11 niveles de score',
        () => ({
          state: 's',
          questions: {
            q: score(
              '?',
              Array.from({ length: 11 }, (_, i) => `n${i}`),
            ),
          },
        }),
        'invalid_request',
      ],
      ['sin preguntas', () => ({ state: 's', questions: {} }), 'invalid_request'],
      [
        'estado enorme',
        () => ({ state: 'x'.repeat(3_000_000), questions: { q: noul('?') } }),
        'context_exceeded',
      ],
      [
        'imágenes que suman más contexto del permitido',
        () => ({
          state: 's',
          images: Array.from({ length: 120 }, () => ({ url: 'https://cdn.test/a.png' })),
          questions: { q: noul('?') },
        }),
        'context_exceeded',
      ],
      [
        'imagen con URL inválida',
        () => ({
          state: 's',
          images: [{ url: 'ftp://cdn.test/a.png' }],
          questions: { q: noul('?') },
        }),
        'invalid_request',
      ],
      [
        'imagen con data URL como base64',
        () => ({
          state: 's',
          images: [{ mimeType: 'image/png', data: 'data:image/png;base64,QUJD' }],
          questions: { q: noul('?') },
        }),
        'invalid_request',
      ],
      [
        'timeoutMs inválido',
        () => ({ state: 's', questions: { q: noul('?') }, timeoutMs: -5 }),
        'invalid_request',
      ],
    ];

    it.each(cases)('%s', async (_label, build, code) => {
      const fetch = okFetch();
      await expect(engineWith(fetch).evaluate(build())).rejects.toMatchObject({ code });
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  it('rechaza 256 opciones en un choice', async () => {
    const make = (n: number) => {
      const options: Record<string, null> = {};
      for (let i = 0; i < n; i += 1) options[`o${i}`] = null;
      return choice('?', options);
    };
    const fetch = okFetch();
    await expect(
      engineWith(fetch).evaluate({ state: 's', questions: { q: make(256) } }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sin API key no está disponible y lanza unavailable sin llamar a fetch', async () => {
    delete process.env[OPENAI_API_KEY_ENV];
    const fetch = okFetch();
    const engine = new OpenAiDecisionEngine({ fetch });

    expect(engine.isAvailable()).toBe(false);
    await expect(engine.evaluate({ state: 's', questions: judgeQuestions })).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('una API key en blanco cuenta como ausente', () => {
    delete process.env[OPENAI_API_KEY_ENV];
    expect(new OpenAiDecisionEngine({ apiKey: '   ' }).isAvailable()).toBe(false);
  });

  it('toma la API key de OPENAI_API_KEY', async () => {
    process.env[OPENAI_API_KEY_ENV] = 'desde-env';
    const fetch = okFetch();
    const engine = new OpenAiDecisionEngine({ fetch, maxRetries: 0 });

    expect(engine.isAvailable()).toBe(true);
    await engine.evaluate({ state: 's', questions: judgeQuestions });
    expect(new Headers(firstCall(fetch).init?.headers).get('authorization')).toBe(
      'Bearer desde-env',
    );
  });

  it('un signal abortado sale como aborted', async () => {
    const fetch = hangingFetch();
    const controller = new AbortController();
    controller.abort();
    await expect(
      engineWith(fetch).evaluate({
        state: 's',
        questions: judgeQuestions,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'aborted' });
  });

  it('traduce un timeout', async () => {
    const fetch = hangingFetch();
    await expect(
      engineWith(fetch).evaluate({ state: 's', questions: judgeQuestions, timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });
});
