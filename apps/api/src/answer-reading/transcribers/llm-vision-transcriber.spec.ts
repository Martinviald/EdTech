import { ServiceUnavailableException } from '@nestjs/common';
import { fakeOutput, renderTranscriptionPrompt, transcriptionZodSchema } from '@soe/answer-reading';
import type { ReaderSpec, ResponseFormat } from '@soe/types';
import type { LlmService } from '../../llm/llm.service';
import type { LlmStructuredResult } from '../../llm/llm.types';
import { LlmVisionTranscriber } from './llm-vision-transcriber';
import type { VisionTranscriptionRequest } from './vision-transcriber';

const FORMAT: ResponseFormat = { kind: 'decimal', maxChars: 6, allowNegative: false };

const READER: ReaderSpec = {
  key: 'haiku',
  transcriberId: 'llm',
  provider: 'anthropic',
  family: 'anthropic-haiku',
  model: 'claude-haiku-5-5',
  promptRef: 'transcribe.short-answer@2',
  hints: 'none',
  params: { maxOutputTokens: 2048, reasoning: 'off', mediaResolution: 'medium', timeoutMs: 30000 },
};

function request(reader: ReaderSpec = READER): VisionTranscriptionRequest {
  return {
    readingKey: 'k'.repeat(64),
    image: { mimeType: 'image/jpeg', base64: 'aGVsbG8=', sha256: 'a'.repeat(64) },
    reader,
    prompt: renderTranscriptionPrompt(reader, FORMAT).prompt,
    outputSchema: transcriptionZodSchema(FORMAT),
    format: FORMAT,
  };
}

function structured(overrides: Partial<LlmStructuredResult> = {}): LlmStructuredResult {
  return {
    data: fakeOutput('2,5'),
    rawText: '{}',
    model: 'claude-haiku-5-5',
    finishReason: 'stop',
    usage: {
      inputTokens: 1000,
      outputTokens: 200,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      imageTokens: 600,
    },
    providerRequestId: null,
    ...overrides,
  };
}

function makeTranscriber(completeStructured: jest.Mock) {
  return new LlmVisionTranscriber({ completeStructured } as unknown as LlmService);
}

describe('LlmVisionTranscriber', () => {
  it('llama a completeStructured con el modelo de la ruta, el prompt renderizado, el esquema del formato y sin org', async () => {
    const completeStructured = jest.fn().mockResolvedValue(structured());

    const result = await makeTranscriber(completeStructured).transcribe(request());

    const [call, orgId, feature] = completeStructured.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
      unknown,
    ];
    expect(orgId).toBeNull();
    expect(feature).toBe('answer_transcription');
    expect(call).toMatchObject({
      target: { provider: 'anthropic', model: 'claude-haiku-5-5' },
      images: [{ mimeType: 'image/jpeg', data: 'aGVsbG8=' }],
      reasoning: 'off',
      mediaResolution: 'medium',
      maxTokens: 2048,
      timeoutMs: 30000,
    });
    expect((call.propertyOrder as string[]).indexOf('characters')).toBeLessThan(
      (call.propertyOrder as string[]).indexOf('literal'),
    );
    expect(result).toMatchObject({
      status: 'ok',
      output: { literal: '2,5' },
      usage: { inputTokens: 1000, outputTokens: 200, imageTokens: 600 },
      errorCode: null,
    });
    expect(result.costUsd).toBeCloseTo((1000 * 0.1 + 200 * 0.5) / 1_000_000, 9);
  });

  it('data null → invalid_output', async () => {
    const result = await makeTranscriber(
      jest.fn().mockResolvedValue(structured({ data: null })),
    ).transcribe(request());
    expect(result).toMatchObject({
      status: 'invalid_output',
      errorCode: 'invalid_json',
      output: null,
    });
  });

  it('una salida que no cumple el esquema del formato → invalid_output', async () => {
    const result = await makeTranscriber(
      jest.fn().mockResolvedValue(structured({ data: { literal: '2,5' } })),
    ).transcribe(request());
    expect(result).toMatchObject({ status: 'invalid_output', errorCode: 'schema_mismatch' });
  });

  it('negativa y salida truncada conservan su estado', async () => {
    const refused = await makeTranscriber(
      jest.fn().mockResolvedValue(structured({ finishReason: 'refusal' })),
    ).transcribe(request());
    const truncated = await makeTranscriber(
      jest.fn().mockResolvedValue(structured({ finishReason: 'max_tokens' })),
    ).transcribe(request());
    expect(refused.status).toBe('refused');
    expect(truncated.status).toBe('truncated');
  });

  it('clasifica timeout, 5xx, 429 y proveedor sin configurar', async () => {
    const timeoutError = Object.assign(new Error('Request timed out.'), {
      name: 'APIConnectionTimeoutError',
    });
    const cases: Array<[unknown, string, string]> = [
      [timeoutError, 'timeout', 'timeout'],
      [Object.assign(new Error('overloaded'), { status: 529 }), 'error', 'provider_unavailable'],
      [Object.assign(new Error('too many'), { status: 429 }), 'error', 'rate_limited'],
      [Object.assign(new Error('bad request'), { status: 400 }), 'error', 'provider_error'],
      [new ServiceUnavailableException('sin clave'), 'error', 'provider_not_configured'],
    ];
    for (const [error, status, errorCode] of cases) {
      const result = await makeTranscriber(jest.fn().mockRejectedValue(error)).transcribe(
        request(),
      );
      expect(result).toMatchObject({ status, errorCode, output: null, costUsd: null });
    }
  });

  it('solo atiende lectores con su id y un proveedor del módulo LLM', () => {
    const transcriber = makeTranscriber(jest.fn());
    expect(transcriber.supports(READER)).toBe(true);
    expect(transcriber.supports({ ...READER, transcriberId: 'fake' })).toBe(false);
    expect(transcriber.supports({ ...READER, provider: 'bedrock_anthropic' })).toBe(false);
  });
});
