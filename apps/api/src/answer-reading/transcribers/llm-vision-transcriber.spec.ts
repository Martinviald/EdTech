import { ServiceUnavailableException } from '@nestjs/common';
import {
  fakeAudit,
  fakeOutput,
  fakeVerdict,
  renderReadingAuditPrompt,
  renderTranscriptionPrompt,
  renderVerificationPrompt,
} from '@soe/answer-reading';
import type { ReaderSpec, ResponseFormat } from '@soe/types';
import type { LlmService } from '../../llm/llm.service';
import type { LlmStructuredResult } from '../../llm/llm.types';
import { LlmTimeoutError } from '../../llm/providers/llm-deadline.helpers';
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
  const rendered = renderTranscriptionPrompt(reader, FORMAT, { geometry: { fractionDigits: 2 } });
  return {
    readingKey: 'k'.repeat(64),
    image: { mimeType: 'image/jpeg', base64: 'aGVsbG8=', sha256: 'a'.repeat(64) },
    reader,
    prompt: rendered.prompt,
    outputSchema: rendered.outputZodSchema,
    outputJsonSchema: rendered.outputSchema,
    format: FORMAT,
  };
}

function structured(overrides: Partial<LlmStructuredResult> = {}): LlmStructuredResult {
  return {
    data: fakeOutput('2,5'),
    rawText: '{}',
    model: 'claude-haiku-5-5',
    providerModel: 'claude-haiku-5-5',
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

  it('guarda como providerModel el modelo que respondió y costea con el modelo pedido', async () => {
    const result = await makeTranscriber(
      jest.fn().mockResolvedValue(structured({ providerModel: 'claude-haiku-5-5-20260901' })),
    ).transcribe(request());

    expect(result.providerModel).toBe('claude-haiku-5-5-20260901');
    expect(result.costUsd).toBeCloseTo((1000 * 0.1 + 200 * 0.5) / 1_000_000, 9);
  });

  it('pide al proveedor el esquema del prompt renderizado: una parte por casilla en la lectura por casilla', async () => {
    const completeStructured = jest.fn().mockResolvedValue(
      structured({
        data: { ...fakeOutput('2,75'), parts: { i1: '', i2: '', i3: '2', f1: '7', f2: '5' } },
      }),
    );

    const result = await makeTranscriber(completeStructured).transcribe(
      request({ ...READER, promptRef: 'transcribe.boxes@1', hints: 'format' }),
    );

    const [call] = completeStructured.mock.calls[0] as [{ jsonSchema: { properties: object } }];
    expect(call.jsonSchema.properties).toMatchObject({
      parts: { required: ['i1', 'i2', 'i3', 'f1', 'f2'] },
    });
    expect(result).toMatchObject({ status: 'ok', output: { parts: { i3: '2', f2: '5' } } });
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
      [new LlmTimeoutError(45_000), 'timeout', 'timeout'],
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

  it('verifica con el esquema de verificación y valida el veredicto', async () => {
    const verifier: ReaderSpec = { ...READER, key: 'verificador', promptRef: 'verify.incorrect@1' };
    const rendered = renderVerificationPrompt({
      reader: verifier,
      format: FORMAT,
      agreedReading: { literal: '2,5', parts: null },
      acceptedAnswers: ['2,8'],
    });
    const verifyRequest = {
      readingKey: 'v'.repeat(64),
      image: { mimeType: 'image/jpeg' as const, base64: 'aGVsbG8=', sha256: 'a'.repeat(64) },
      reader: verifier,
      ...rendered,
    };
    const completeStructured = jest
      .fn()
      .mockResolvedValueOnce(structured({ data: fakeVerdict(true, 0.9) }))
      .mockResolvedValueOnce(structured({ data: fakeOutput('2,5') }));
    const transcriber = makeTranscriber(completeStructured);

    const ok = await transcriber.verify(verifyRequest);
    const invalid = await transcriber.verify(verifyRequest);

    const [call] = completeStructured.mock.calls[0] as [Record<string, unknown>];
    expect(call).toMatchObject({
      schemaName: 'incorrect_verification',
      propertyOrder: ['notes', 'differingCharacters', 'couldBeKey', 'confidence'],
    });
    expect(call['prompt']).toContain('2,8');
    expect(ok).toMatchObject({ status: 'ok', output: { couldBeKey: true, confidence: 0.9 } });
    expect(invalid).toMatchObject({ status: 'invalid_output', output: null });
  });

  it('audita con el esquema del auditor y valida el veredicto', async () => {
    const auditor: ReaderSpec = { ...READER, key: 'auditor', promptRef: 'audit.reading@1' };
    const rendered = renderReadingAuditPrompt({
      reader: auditor,
      format: FORMAT,
      candidate: { literal: '2,5', parts: null },
      stem: null,
    });
    const auditRequest = {
      readingKey: 'w'.repeat(64),
      image: { mimeType: 'image/jpeg' as const, base64: 'aGVsbG8=', sha256: 'a'.repeat(64) },
      reader: auditor,
      ...rendered,
    };
    const completeStructured = jest
      .fn()
      .mockResolvedValueOnce(structured({ data: fakeAudit('approve', 0.92) }))
      .mockResolvedValueOnce(structured({ data: fakeVerdict(true, 0.9) }));
    const transcriber = makeTranscriber(completeStructured);

    const ok = await transcriber.audit(auditRequest);
    const invalid = await transcriber.audit(auditRequest);

    const [call] = completeStructured.mock.calls[0] as [Record<string, unknown>];
    expect(call).toMatchObject({
      schemaName: 'reading_audit',
      propertyOrder: ['notes', 'suspiciousCharacters', 'verdict', 'confidence'],
    });
    expect(call['prompt']).toContain('2,5');
    expect(ok).toMatchObject({ status: 'ok', output: { verdict: 'approve', confidence: 0.92 } });
    expect(invalid).toMatchObject({ status: 'invalid_output', output: null });
  });
});
