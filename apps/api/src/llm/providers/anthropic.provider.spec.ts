import { AnthropicProvider } from './anthropic.provider';
import type { LlmCompletionRequest, LlmStructuredRequest } from '../llm.types';

interface FakeMessageResponse {
  id?: string;
  content: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
}

function makeProvider(response: FakeMessageResponse) {
  const provider = new AnthropicProvider();
  const create = jest.fn(
    (_req: Record<string, unknown>, _opts?: { timeout?: number; maxRetries?: number }) =>
      Promise.resolve(response),
  );
  (provider as unknown as { client: unknown }).client = { messages: { create } };
  return { provider, create };
}

function makeRequest(overrides: Partial<LlmCompletionRequest> = {}): LlmCompletionRequest {
  return {
    system: 'eres un corrector',
    prompt: 'transcribe la respuesta',
    options: { model: 'claude-haiku-5-5', maxTokens: 1024 },
    ...overrides,
  };
}

const RESPONSE: FakeMessageResponse = {
  content: [{ type: 'text', text: '{"value":"2,1"}' }],
  usage: { input_tokens: 1200, output_tokens: 30 },
};

describe('AnthropicProvider', () => {
  it('completeWithUsage devuelve texto, modelo y uso de tokens', async () => {
    const { provider } = makeProvider(RESPONSE);

    const result = await provider.completeWithUsage(makeRequest());

    expect(result).toEqual({
      text: '{"value":"2,1"}',
      model: 'claude-haiku-5-5',
      usage: { inputTokens: 1200, outputTokens: 30 },
    });
  });

  it('no envía temperatura cuando la solicitud no la define', async () => {
    const { provider, create } = makeProvider(RESPONSE);

    await provider.completeWithUsage(makeRequest());

    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('temperature');
  });

  it('envía la temperatura cuando la solicitud la define', async () => {
    const { provider, create } = makeProvider(RESPONSE);

    await provider.complete(
      makeRequest({ options: { model: 'claude-sonnet-4-6', maxTokens: 1024, temperature: 0 } }),
    );

    expect(create.mock.calls[0]?.[0]).toMatchObject({ temperature: 0 });
  });

  it('completeMultimodalWithUsage adjunta las imágenes y reporta el uso', async () => {
    const { provider, create } = makeProvider(RESPONSE);

    const result = await provider.completeMultimodalWithUsage(
      makeRequest({ images: [{ mimeType: 'image/jpeg', data: 'QUJD' }] }),
    );

    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 30 });
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'transcribe la respuesta' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' },
            },
          ],
        },
      ],
    });
  });

  it('completeMultimodalWithUsage sin imágenes manda solo el texto', async () => {
    const { provider, create } = makeProvider(RESPONSE);

    await provider.completeMultimodalWithUsage(makeRequest({ images: [] }));

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      messages: [{ role: 'user', content: 'transcribe la respuesta' }],
    });
  });

  it('devuelve usage null cuando la respuesta no trae uso', async () => {
    const { provider } = makeProvider({ content: [{ type: 'text', text: 'ok' }] });

    const result = await provider.completeWithUsage(makeRequest());

    expect(result).toEqual({ text: 'ok', model: 'claude-haiku-5-5', usage: null });
  });
});

const STRUCTURED_SCHEMA = {
  type: 'object',
  properties: { literal: { type: 'string' }, confidence: { type: 'number' } },
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
    propertyOrder: ['literal', 'confidence'],
    options: {
      model: 'claude-haiku-5-5',
      maxTokens: 512,
      reasoning: 'off',
      timeoutMs: 15_000,
      ...overrides,
    },
  };
}

const STRUCTURED_RESPONSE: FakeMessageResponse = {
  id: 'msg_123',
  content: [{ type: 'thinking' }, { type: 'text', text: '{"literal":"2,5","confidence":0.93}' }],
  stop_reason: 'end_turn',
  usage: {
    input_tokens: 900,
    output_tokens: 20,
    cache_read_input_tokens: 100,
    cache_creation_input_tokens: 0,
  },
};

describe('AnthropicProvider.completeStructured', () => {
  it('arma la request con imagen antes del texto, schema, sin razonamiento y sin temperatura', async () => {
    const { provider, create } = makeProvider(STRUCTURED_RESPONSE);

    await provider.completeStructured(makeStructuredRequest());

    const [body, requestOptions] = create.mock.calls[0] ?? [];
    expect(body).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 512,
      system: 'transcribe sin corregir',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
            { type: 'text', text: 'lee la respuesta' },
          ],
        },
      ],
      thinking: { type: 'disabled' },
      output_config: { format: { type: 'json_schema', schema: STRUCTURED_SCHEMA } },
    });
    expect(body).not.toHaveProperty('temperature');
    expect(requestOptions).toEqual({ timeout: 15_000, maxRetries: 1 });
  });

  it('con razonamiento usa thinking adaptativo y el esfuerzo pedido', async () => {
    const { provider, create } = makeProvider(STRUCTURED_RESPONSE);

    await provider.completeStructured(makeStructuredRequest({ reasoning: 'low' }));

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      thinking: { type: 'adaptive' },
      output_config: {
        format: { type: 'json_schema', schema: STRUCTURED_SCHEMA },
        effort: 'low',
      },
    });
  });

  it('parsea el primer bloque de texto y reporta el uso completo', async () => {
    const { provider } = makeProvider(STRUCTURED_RESPONSE);

    const result = await provider.completeStructured(makeStructuredRequest());

    expect(result).toEqual({
      data: { literal: '2,5', confidence: 0.93 },
      rawText: '{"literal":"2,5","confidence":0.93}',
      model: 'claude-haiku-5-5',
      finishReason: 'stop',
      usage: {
        inputTokens: 1000,
        outputTokens: 20,
        reasoningTokens: 0,
        cachedInputTokens: 100,
        imageTokens: null,
      },
      providerRequestId: 'msg_123',
    });
  });

  it.each([
    ['refusal', 'refusal'],
    ['max_tokens', 'max_tokens'],
    ['pause_turn', 'other'],
  ])('traduce stop_reason %s a finishReason %s', async (stopReason, finishReason) => {
    const { provider } = makeProvider({ ...STRUCTURED_RESPONSE, stop_reason: stopReason });

    const result = await provider.completeStructured(makeStructuredRequest());

    expect(result.finishReason).toBe(finishReason);
  });

  it('devuelve data null cuando el texto no es JSON válido', async () => {
    const { provider } = makeProvider({
      content: [{ type: 'text', text: '{"literal":' }],
      stop_reason: 'max_tokens',
    });

    const result = await provider.completeStructured(makeStructuredRequest());

    expect(result.data).toBeNull();
    expect(result.rawText).toBe('{"literal":');
    expect(result.usage).toBeNull();
    expect(result.providerRequestId).toBeNull();
  });
});
