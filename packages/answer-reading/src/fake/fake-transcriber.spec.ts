import type { ReaderSpec, ResponseFormat } from '@soe/types';
import { renderTranscriptionPrompt } from '../prompts/registry';
import type { TranscriptionRequest } from '../transcriber';
import { FakeTranscriber, fakeOutput } from './fake-transcriber';

const FORMAT: ResponseFormat = { kind: 'integer', maxChars: 4, allowNegative: false };
const READER: ReaderSpec = {
  key: 'fake-a',
  transcriberId: 'fake',
  provider: 'anthropic',
  family: 'claude',
  model: 'fake-model',
  promptRef: 'transcribe.short-answer@2',
  hints: 'none',
  params: { maxOutputTokens: 400, reasoning: 'off', timeoutMs: 1000 },
};

function request(sha256: string, readingKey = 'k', reader = READER): TranscriptionRequest {
  const rendered = renderTranscriptionPrompt(reader, FORMAT);
  return {
    readingKey,
    image: { mimeType: 'image/jpeg', base64: '', sha256 },
    reader,
    prompt: rendered.prompt,
    outputSchema: rendered.outputZodSchema,
    outputJsonSchema: rendered.outputSchema,
  };
}

describe('FakeTranscriber', () => {
  it('devuelve la salida programada por sha256 y registra la llamada', async () => {
    const fake = new FakeTranscriber({ bySha256: { abc: fakeOutput('68') } });
    const result = await fake.transcribe(request('abc'));
    expect(result).toMatchObject({ status: 'ok', providerModel: 'fake-model', errorCode: null });
    expect(result.output?.literal).toBe('68');
    expect(fake.calls).toHaveLength(1);
  });

  it('la clave de lectura gana al sha256, y se puede programar por lector', async () => {
    const fake = new FakeTranscriber({
      bySha256: { abc: fakeOutput('1') },
      byReadingKey: { especial: fakeOutput('2') },
      byReader: { 'fake-b': { abc: fakeOutput('3') } },
    });
    expect((await fake.transcribe(request('abc', 'especial'))).output?.literal).toBe('2');
    expect(
      (await fake.transcribe(request('abc', 'k', { ...READER, key: 'fake-b' }))).output?.literal,
    ).toBe('3');
  });

  it('sin programación falla con fake_missing; las fallas programadas se respetan', async () => {
    const fake = new FakeTranscriber({ bySha256: { t: { status: 'timeout' } } });
    expect(await fake.transcribe(request('nada'))).toMatchObject({
      status: 'error',
      output: null,
      errorCode: 'fake_missing',
    });
    expect(await fake.transcribe(request('t'))).toMatchObject({
      status: 'timeout',
      errorCode: 'fake_timeout',
    });
  });

  it('valida la salida contra el esquema del request', async () => {
    const fake = new FakeTranscriber({
      fallback: fakeOutput('68', { parts: { numerator: '6' } }),
    });
    expect((await fake.transcribe(request('x'))).status).toBe('invalid_output');
  });

  it('atiende solo a los lectores con su id', () => {
    const fake = new FakeTranscriber();
    expect(fake.supports(READER)).toBe(true);
    expect(fake.supports({ ...READER, transcriberId: 'llm' })).toBe(false);
  });
});
