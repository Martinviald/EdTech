import { ServiceUnavailableException } from '@nestjs/common';
import { LlmService } from './llm.service';
import type { LlmConfigService } from './llm.config';
import type {
  LlmProvider,
  LlmRuntimeConfig,
  LlmStructuredCall,
  LlmStructuredRequest,
  LlmStructuredResult,
} from './llm.types';

const RESULT: LlmStructuredResult = {
  data: { literal: '2,5' },
  rawText: '{"literal":"2,5"}',
  model: 'modelo-del-proveedor',
  finishReason: 'stop',
  usage: null,
  providerRequestId: 'req-1',
};

function makeConfig(): {
  config: LlmConfigService;
  resolve: jest.Mock;
  forChoice: jest.Mock;
} {
  const resolve = jest.fn(
    (): Promise<LlmRuntimeConfig> =>
      Promise.resolve({ provider: 'anthropic', model: 'claude-haiku-5-5', maxTokens: 8192 }),
  );
  const forChoice = jest.fn(
    (choice: { provider: 'gemini' | 'anthropic'; model: string }): Promise<LlmRuntimeConfig> =>
      Promise.resolve({ ...choice, maxTokens: 65536 }),
  );
  return { config: { resolve, forChoice } as unknown as LlmConfigService, resolve, forChoice };
}

function makeProvider(name: 'anthropic' | 'gemini', structured = true) {
  const completeStructured = jest.fn((_req: LlmStructuredRequest) => Promise.resolve(RESULT));
  const provider: LlmProvider = {
    name,
    isAvailable: () => true,
    complete: () => Promise.resolve(''),
    ...(structured ? { completeStructured } : {}),
  };
  return { provider, completeStructured };
}

function makeCall(overrides: Partial<LlmStructuredCall> = {}): LlmStructuredCall {
  return {
    system: 's',
    prompt: 'p',
    images: [],
    jsonSchema: {
      type: 'object',
      properties: { confidence: { type: 'number' }, literal: { type: 'string' } },
    },
    schemaName: 'transcription',
    propertyOrder: ['literal', 'confidence'],
    ...overrides,
  };
}

describe('LlmService.completeStructured', () => {
  it('resuelve el modelo por funcionalidad y aplica los valores por defecto', async () => {
    const { config, resolve } = makeConfig();
    const { provider, completeStructured } = makeProvider('anthropic');

    const result = await new LlmService(config, [provider]).completeStructured(
      makeCall(),
      'org-1',
      'answer_transcription',
    );

    expect(resolve).toHaveBeenCalledWith('org-1', 'answer_transcription');
    const request = completeStructured.mock.calls[0]?.[0];
    expect(request?.options).toEqual({
      model: 'claude-haiku-5-5',
      maxTokens: 8192,
      reasoning: 'off',
      timeoutMs: 30_000,
    });
    expect(Object.keys((request?.jsonSchema.properties ?? {}) as object)).toEqual([
      'literal',
      'confidence',
    ]);
    expect(result.model).toBe('claude-haiku-5-5');
  });

  it('usa el modelo fijado por la ruta y respeta las opciones explícitas', async () => {
    const { config, resolve, forChoice } = makeConfig();
    const { provider, completeStructured } = makeProvider('gemini');

    await new LlmService(config, [provider]).completeStructured(
      makeCall({
        target: { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
        reasoning: 'low',
        mediaResolution: 'high',
        maxTokens: 256,
        timeoutMs: 5_000,
      }),
      'org-1',
      'answer_transcription',
    );

    expect(resolve).not.toHaveBeenCalled();
    expect(forChoice).toHaveBeenCalledWith({ provider: 'gemini', model: 'gemini-3.5-flash-lite' });
    expect(completeStructured.mock.calls[0]?.[0].options).toEqual({
      model: 'gemini-3.5-flash-lite',
      maxTokens: 256,
      reasoning: 'low',
      mediaResolution: 'high',
      timeoutMs: 5_000,
    });
  });

  it('responde 503 si el proveedor no soporta salida estructurada', async () => {
    const { config } = makeConfig();
    const { provider } = makeProvider('anthropic', false);

    await expect(
      new LlmService(config, [provider]).completeStructured(
        makeCall(),
        null,
        'answer_transcription',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
