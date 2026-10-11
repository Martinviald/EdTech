import { AnthropicProvider } from './anthropic.provider';
import type { LlmCompletionRequest } from '../llm.types';

interface FakeMessageResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function makeProvider(response: FakeMessageResponse) {
  const provider = new AnthropicProvider();
  const create = jest.fn((_req: Record<string, unknown>) => Promise.resolve(response));
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
