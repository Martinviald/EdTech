import OpenAI from 'openai';
import { OpenAiProvider } from './openai.provider';
import type {
  LlmAgentEvent,
  LlmAgentRequest,
  LlmCompletionRequest,
  LlmStructuredRequest,
} from '../llm.types';

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn(() => ({ responses: { create: jest.fn() } })),
}));

const OpenAiConstructor = OpenAI as unknown as jest.Mock;

interface FakeResponse {
  id?: string;
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{
    type: string;
    content?: Array<{ type: string; text?: string; refusal?: string }>;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    input_tokens_details?: { cached_tokens: number };
    output_tokens_details?: { reasoning_tokens: number };
  };
}

type CreateArgs = [Record<string, unknown>, { timeout?: number; signal?: AbortSignal }?];
type CreateMock = jest.Mock<Promise<unknown>, CreateArgs>;

function makeCreate(impl: (...args: CreateArgs) => Promise<unknown>): CreateMock {
  return jest.fn<Promise<unknown>, CreateArgs>(impl);
}

function withApiKey<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.OPENAI_API_KEY;
  if (value === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
}

function makeProvider(create: CreateMock) {
  const provider = withApiKey('sk-test', () => new OpenAiProvider());
  (provider as unknown as { client: unknown }).client = { responses: { create } };
  return provider;
}

function respondWith(response: FakeResponse): CreateMock {
  return makeCreate(() => Promise.resolve(response));
}

function textMessage(text: string) {
  return { type: 'message', content: [{ type: 'output_text', text }] };
}

const USAGE = {
  input_tokens: 1200,
  output_tokens: 90,
  input_tokens_details: { cached_tokens: 200 },
  output_tokens_details: { reasoning_tokens: 60 },
};

function makeRequest(overrides: Partial<LlmCompletionRequest> = {}): LlmCompletionRequest {
  return {
    system: 'eres un corrector',
    prompt: 'transcribe la respuesta',
    options: { model: 'gpt-5.4-mini', maxTokens: 1024 },
    ...overrides,
  };
}

const STRUCTURED_SCHEMA = {
  type: 'object',
  properties: {
    literal: { type: 'string' },
    confidence: { type: 'number' },
    note: { type: 'string' },
  },
  required: ['literal', 'confidence'],
  additionalProperties: false,
};

function makeStructuredRequest(
  overrides: Partial<LlmStructuredRequest['options']> = {},
): LlmStructuredRequest {
  return {
    system: 'transcribe sin corregir',
    prompt: 'lee la respuesta',
    images: [{ mimeType: 'image/jpeg', data: 'QUJD' }],
    jsonSchema: STRUCTURED_SCHEMA,
    schemaName: 'transcription',
    propertyOrder: ['literal', 'confidence', 'note'],
    options: {
      model: 'gpt-6-luna',
      maxTokens: 512,
      reasoning: 'off',
      timeoutMs: 15_000,
      ...overrides,
    },
  };
}

const STRUCTURED_RESPONSE: FakeResponse = {
  id: 'resp_123',
  status: 'completed',
  output: [{ type: 'reasoning' }, textMessage('{"literal":"2,5","confidence":0.93,"note":null}')],
  usage: USAGE,
};

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { status: 400 });
}

function unsupportedParam(param: string, value: string, model: string): Error {
  const message = `Unsupported value: '${value}' is not supported with the '${model}' model. Supported values are: 'low', 'medium', 'high', 'xhigh', and 'max'.`;
  return Object.assign(new Error(`400 ${message}`), {
    status: 400,
    code: 'unsupported_value',
    param,
    type: 'invalid_request_error',
    error: { message, type: 'invalid_request_error', param, code: 'unsupported_value' },
  });
}

describe('OpenAiProvider', () => {
  beforeEach(() => OpenAiConstructor.mockClear());

  it('sin OPENAI_API_KEY queda no disponible y no construye el cliente', () => {
    const provider = withApiKey(undefined, () => new OpenAiProvider());

    expect(provider.isAvailable()).toBe(false);
    expect(OpenAiConstructor).not.toHaveBeenCalled();
  });

  it('con OPENAI_API_KEY construye el SDK con la clave y queda disponible', () => {
    const provider = withApiKey('sk-test', () => new OpenAiProvider());

    expect(provider.isAvailable()).toBe(true);
    expect(OpenAiConstructor).toHaveBeenCalledWith({ apiKey: 'sk-test' });
  });

  it('sin cliente rechaza las llamadas', async () => {
    const provider = withApiKey(undefined, () => new OpenAiProvider());

    await expect(provider.complete(makeRequest())).rejects.toThrow('no está disponible');
  });

  it('completeWithUsage usa la Responses API sin temperatura y devuelve texto y uso', async () => {
    const create = respondWith({
      status: 'completed',
      output: [textMessage('hola')],
      usage: USAGE,
    });

    const result = await makeProvider(create).completeWithUsage(makeRequest());

    expect(create.mock.calls[0]?.[0]).toEqual({
      model: 'gpt-5.4-mini',
      instructions: 'eres un corrector',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'transcribe la respuesta' }] }],
      max_output_tokens: 1024,
      store: false,
    });
    expect(result).toEqual({
      text: 'hola',
      model: 'gpt-5.4-mini',
      usage: { inputTokens: 1200, outputTokens: 90, cachedInputTokens: 200 },
    });
  });

  it('envía la temperatura cuando la solicitud la define', async () => {
    const create = respondWith({ status: 'completed', output: [textMessage('ok')] });

    await makeProvider(create).complete(
      makeRequest({ options: { model: 'gpt-5.4-mini', maxTokens: 64, temperature: 0 } }),
    );

    expect(create.mock.calls[0]?.[0]).toMatchObject({ temperature: 0 });
  });

  it('completeMultimodalWithUsage adjunta las imágenes como data URL', async () => {
    const create = respondWith({ status: 'completed', output: [textMessage('ok')] });

    const result = await makeProvider(create).completeMultimodalWithUsage(
      makeRequest({ images: [{ mimeType: 'image/png', data: 'QUJD' }] }),
    );

    expect(result.usage).toBeNull();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'transcribe la respuesta' },
            { type: 'input_image', detail: 'auto', image_url: 'data:image/png;base64,QUJD' },
          ],
        },
      ],
    });
  });
});

describe('OpenAiProvider.completeStructured', () => {
  it('arma la request con formato json_schema estricto, imagen antes del texto y razonamiento mínimo', async () => {
    const create = respondWith(STRUCTURED_RESPONSE);

    await makeProvider(create).completeStructured(makeStructuredRequest());

    const [body, requestOptions] = create.mock.calls[0] ?? [];
    expect(body).toEqual({
      model: 'gpt-6-luna',
      instructions: 'transcribe sin corregir',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_image', detail: 'auto', image_url: 'data:image/jpeg;base64,QUJD' },
            { type: 'input_text', text: 'lee la respuesta' },
          ],
        },
      ],
      max_output_tokens: 512,
      store: false,
      text: {
        format: {
          type: 'json_schema',
          name: 'transcription',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              literal: { type: 'string' },
              confidence: { type: 'number' },
              note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            },
            required: ['literal', 'confidence', 'note'],
            additionalProperties: false,
          },
        },
      },
      reasoning: { effort: 'none' },
    });
    expect(body).not.toHaveProperty('temperature');
    expect(requestOptions).toEqual({
      timeout: expect.any(Number),
      signal: expect.any(AbortSignal),
    });
    expect(requestOptions?.timeout).toBeGreaterThan(14_000);
    expect(requestOptions?.timeout).toBeLessThanOrEqual(15_000);
  });

  it('vuelve estricto un objeto anidado y quita $schema', async () => {
    const create = respondWith(STRUCTURED_RESPONSE);
    const request = makeStructuredRequest();
    request.jsonSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: { type: 'object', properties: { value: { type: 'string' } } },
        },
      },
      required: ['fields'],
    };

    await makeProvider(create).completeStructured(request);

    const format = (create.mock.calls[0]?.[0].text as { format: { schema: unknown } }).format;
    expect(format.schema).toEqual({
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: { value: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
            required: ['value'],
            additionalProperties: false,
          },
        },
      },
      required: ['fields'],
      additionalProperties: false,
    });
  });

  it('usa la resolución de imagen pedida como detail', async () => {
    const create = respondWith(STRUCTURED_RESPONSE);

    await makeProvider(create).completeStructured(
      makeStructuredRequest({ mediaResolution: 'high' }),
    );

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      input: [{ content: [{ type: 'input_image', detail: 'high' }, { type: 'input_text' }] }],
    });
  });

  it('con razonamiento envía el esfuerzo pedido', async () => {
    const create = respondWith(STRUCTURED_RESPONSE);

    await makeProvider(create).completeStructured(makeStructuredRequest({ reasoning: 'low' }));

    expect(create.mock.calls[0]?.[0]).toMatchObject({ reasoning: { effort: 'low' } });
  });

  it('en la familia gpt-5 original apaga el razonamiento con minimal', async () => {
    const create = respondWith(STRUCTURED_RESPONSE);

    await makeProvider(create).completeStructured(makeStructuredRequest({ model: 'gpt-5-mini' }));

    expect(create.mock.calls[0]?.[0]).toMatchObject({ reasoning: { effort: 'minimal' } });
  });

  it('si el modelo rechaza el esfuerzo mínimo baja al siguiente y lo recuerda', async () => {
    const create = makeCreate((body) => {
      const effort = (body.reasoning as { effort?: string } | undefined)?.effort;
      return effort === 'none'
        ? Promise.reject(badRequest("Unsupported value: 'none' for reasoning.effort"))
        : Promise.resolve(STRUCTURED_RESPONSE);
    });
    const provider = makeProvider(create);

    await provider.completeStructured(makeStructuredRequest());
    await provider.completeStructured(makeStructuredRequest());

    const efforts = create.mock.calls.map(
      ([body]) => (body.reasoning as { effort?: string } | undefined)?.effort,
    );
    expect(efforts).toEqual(['none', 'minimal', 'minimal']);
  });

  it('reconoce el rechazo real de la API por el parámetro reasoning.effort aunque el mensaje no lo nombre', async () => {
    const create = makeCreate((body) => {
      const effort = (body.reasoning as { effort?: string } | undefined)?.effort;
      return effort === 'none' || effort === 'minimal'
        ? Promise.reject(unsupportedParam('reasoning.effort', effort, 'gpt-6.1-sol'))
        : Promise.resolve(STRUCTURED_RESPONSE);
    });
    const provider = makeProvider(create);

    await provider.completeStructured(makeStructuredRequest({ model: 'gpt-6.1-sol' }));
    await provider.completeStructured(makeStructuredRequest({ model: 'gpt-6.1-sol' }));

    const efforts = create.mock.calls.map(
      ([body]) => (body.reasoning as { effort?: string } | undefined)?.effort,
    );
    expect(efforts).toEqual(['none', 'minimal', 'low', 'low']);
  });

  it('no reintenta si el error estructurado señala otro parámetro aunque el mensaje hable de razonamiento', async () => {
    const create = makeCreate(() =>
      Promise.reject(unsupportedParam('text.format', 'reasoning_schema', 'gpt-6.1-sol')),
    );

    await expect(
      makeProvider(create).completeStructured(makeStructuredRequest({ model: 'gpt-6.1-sol' })),
    ).rejects.toThrow('reasoning_schema');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('no reintenta ante un error que no es del razonamiento', async () => {
    const create = makeCreate(() => Promise.reject(badRequest('Invalid schema')));

    await expect(makeProvider(create).completeStructured(makeStructuredRequest())).rejects.toThrow(
      'Invalid schema',
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('parsea el JSON, quita los null de propiedades opcionales y reporta el uso completo', async () => {
    const result = await makeProvider(respondWith(STRUCTURED_RESPONSE)).completeStructured(
      makeStructuredRequest(),
    );

    expect(result).toEqual({
      data: { literal: '2,5', confidence: 0.93 },
      rawText: '{"literal":"2,5","confidence":0.93,"note":null}',
      model: 'gpt-6-luna',
      providerModel: 'gpt-6-luna',
      finishReason: 'stop',
      usage: {
        inputTokens: 1200,
        outputTokens: 90,
        reasoningTokens: 60,
        cachedInputTokens: 200,
        imageTokens: null,
      },
      providerRequestId: 'resp_123',
    });
  });

  it('devuelve como providerModel el modelo que trae la respuesta', async () => {
    const create = respondWith({ ...STRUCTURED_RESPONSE, model: 'gpt-6-luna-2026-09-01' });

    const result = await makeProvider(create).completeStructured(makeStructuredRequest());

    expect(result.model).toBe('gpt-6-luna');
    expect(result.providerModel).toBe('gpt-6-luna-2026-09-01');
  });

  it.each([
    ['max_output_tokens', 'max_tokens'],
    ['content_filter', 'safety'],
  ])('traduce incomplete_details %s a finishReason %s', async (reason, finishReason) => {
    const create = respondWith({
      ...STRUCTURED_RESPONSE,
      status: 'incomplete',
      incomplete_details: { reason },
    });

    const result = await makeProvider(create).completeStructured(makeStructuredRequest());

    expect(result.finishReason).toBe(finishReason);
  });

  it('reporta el rechazo del modelo con data null y su texto', async () => {
    const create = respondWith({
      id: 'resp_9',
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No puedo ayudar.' }] }],
      usage: USAGE,
    });

    const result = await makeProvider(create).completeStructured(makeStructuredRequest());

    expect(result.finishReason).toBe('refusal');
    expect(result.data).toBeNull();
    expect(result.rawText).toBe('No puedo ayudar.');
  });

  it('devuelve data null cuando el texto no es JSON válido', async () => {
    const create = respondWith({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [textMessage('{"literal":')],
    });

    const result = await makeProvider(create).completeStructured(makeStructuredRequest());

    expect(result.data).toBeNull();
    expect(result.rawText).toBe('{"literal":');
    expect(result.finishReason).toBe('max_tokens');
    expect(result.usage).toBeNull();
    expect(result.providerRequestId).toBeNull();
  });
});

describe('OpenAiProvider.completeStructured con plazo total', () => {
  const TIMEOUT_MS = 80;
  const MARGIN_MS = 150;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function elapsedFailure(
    run: () => Promise<unknown>,
  ): Promise<{ error: unknown; ms: number }> {
    const startedAt = Date.now();
    const error = await run().then(
      () => null,
      (failure: unknown) => failure,
    );
    return { error, ms: Date.now() - startedAt };
  }

  it('una llamada que nunca responde termina en timeout dentro del plazo', async () => {
    const create = makeCreate(() => new Promise<never>(() => undefined));
    const provider = makeProvider(create);

    const { error, ms } = await elapsedFailure(() =>
      provider.completeStructured(makeStructuredRequest({ timeoutMs: TIMEOUT_MS })),
    );

    expect((error as Error).name).toBe('TimeoutError');
    expect(ms).toBeLessThan(TIMEOUT_MS + MARGIN_MS);
    expect(create.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('un cliente que reintenta sin respetar el timeout por intento igual corta en el plazo total', async () => {
    const create = makeCreate(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) await sleep(TIMEOUT_MS);
      return STRUCTURED_RESPONSE;
    });
    const provider = makeProvider(create);

    const { error, ms } = await elapsedFailure(() =>
      provider.completeStructured(makeStructuredRequest({ timeoutMs: TIMEOUT_MS })),
    );

    expect((error as Error).name).toBe('TimeoutError');
    expect(ms).toBeLessThan(TIMEOUT_MS + MARGIN_MS);
  });

  it('la escalera de esfuerzo comparte el plazo: cada escalón recibe el tiempo que queda', async () => {
    const create = makeCreate(async (body, options) => {
      const effort = (body.reasoning as { effort?: string } | undefined)?.effort;
      if (effort === 'low') {
        return new Promise<never>((_, reject) =>
          options?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' })),
          ),
        );
      }
      await sleep(30);
      throw badRequest(`Unsupported value: '${effort}' for reasoning.effort`);
    });
    const provider = makeProvider(create);

    const { error, ms } = await elapsedFailure(() =>
      provider.completeStructured(makeStructuredRequest({ timeoutMs: TIMEOUT_MS })),
    );

    expect((error as Error).name).toBe('TimeoutError');
    expect(ms).toBeLessThan(TIMEOUT_MS + MARGIN_MS);
    const timeouts = create.mock.calls.map(([, options]) => options?.timeout ?? 0);
    expect(timeouts).toHaveLength(3);
    expect(timeouts[1]).toBeLessThan(timeouts[0]!);
    expect(timeouts[2]).toBeLessThan(timeouts[1]!);
    expect(timeouts[0]).toBeLessThanOrEqual(TIMEOUT_MS);
  });
});

describe('OpenAiProvider.streamWithTools', () => {
  function streamOf(events: Array<Record<string, unknown>>): CreateMock {
    return makeCreate(() =>
      Promise.resolve(
        (async function* () {
          for (const event of events) yield event;
        })(),
      ),
    );
  }

  async function collect(stream: AsyncIterable<LlmAgentEvent>): Promise<LlmAgentEvent[]> {
    const events: LlmAgentEvent[] = [];
    for await (const event of stream) events.push(event);
    return events;
  }

  const AGENT_REQUEST: LlmAgentRequest = {
    system: 'eres el asistente',
    tools: [
      {
        name: 'get_heatmap',
        description: 'Mapa de calor',
        inputSchema: { type: 'object', properties: { grade: { type: 'string' } } },
      },
    ],
    messages: [
      { role: 'user', content: [{ type: 'text', text: '¿cómo va 4° básico?' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reviso.' },
          { type: 'tool_use', id: 'call_1', name: 'get_heatmap', input: { grade: '4' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', toolCallId: 'call_1', content: '{"ok":true}' }],
      },
    ],
    options: { model: 'gpt-5.4-mini', maxTokens: 2048 },
  };

  it('traduce historial y tools a la Responses API con streaming', async () => {
    const create = streamOf([]);

    await collect(makeProvider(create).streamWithTools(AGENT_REQUEST));

    expect(create.mock.calls[0]?.[0]).toEqual({
      model: 'gpt-5.4-mini',
      instructions: 'eres el asistente',
      input: [
        { role: 'user', content: '¿cómo va 4° básico?' },
        { role: 'assistant', content: 'Reviso.' },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'get_heatmap',
          arguments: '{"grade":"4"}',
        },
        { type: 'function_call_output', call_id: 'call_1', output: '{"ok":true}' },
      ],
      max_output_tokens: 2048,
      store: false,
      stream: true,
      tools: [
        {
          type: 'function',
          name: 'get_heatmap',
          description: 'Mapa de calor',
          parameters: { type: 'object', properties: { grade: { type: 'string' } } },
          strict: false,
        },
      ],
    });
  });

  it('emite texto, la llamada a función, el uso y cierra con tool_use', async () => {
    const create = streamOf([
      { type: 'response.output_text.delta', delta: 'Voy a ' },
      { type: 'response.output_text.delta', delta: 'consultar.' },
      {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'call_7',
          name: 'get_heatmap',
          arguments: '{"grade":"4"}',
        },
      },
      {
        type: 'response.completed',
        response: { status: 'completed', usage: { input_tokens: 300, output_tokens: 40 } },
      },
    ]);

    const events = await collect(makeProvider(create).streamWithTools(AGENT_REQUEST));

    expect(events).toEqual([
      { type: 'text_delta', text: 'Voy a ' },
      { type: 'text_delta', text: 'consultar.' },
      { type: 'tool_call', id: 'call_7', name: 'get_heatmap', input: { grade: '4' } },
      { type: 'usage', inputTokens: 300, outputTokens: 40 },
      { type: 'done', stopReason: 'tool_use' },
    ]);
  });

  it('cierra con max_tokens cuando la respuesta queda incompleta', async () => {
    const create = streamOf([
      {
        type: 'response.incomplete',
        response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
      },
    ]);

    const events = await collect(makeProvider(create).streamWithTools(AGENT_REQUEST));

    expect(events).toEqual([{ type: 'done', stopReason: 'max_tokens' }]);
  });

  it('propaga el error del stream', async () => {
    const create = streamOf([{ type: 'error', message: 'rate limit' }]);

    await expect(collect(makeProvider(create).streamWithTools(AGENT_REQUEST))).rejects.toThrow(
      'rate limit',
    );
  });
});
