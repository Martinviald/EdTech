import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fakeOutput,
  renderTranscriptionPrompt,
  type TranscriptionResult,
} from '@soe/answer-reading';
import type { ReaderSpec, ResponseFormat } from '@soe/types';
import {
  CALL_LEDGER_FILE,
  ReadingCache,
  cachedReadingEntry,
  readingCacheKey,
  type ReadingCacheKeyInput,
} from './reading-cache';

const FORMAT: ResponseFormat = { kind: 'integer', maxChars: 4, allowNegative: false };

const READER: ReaderSpec = {
  key: 'gemini-3.5-flash',
  transcriberId: 'llm',
  provider: 'gemini',
  family: 'gemini-flash',
  model: 'gemini-3.5-flash',
  promptRef: 'transcribe.short-answer@2',
  hints: 'none',
  params: { maxOutputTokens: 2048, reasoning: 'off', mediaResolution: 'medium', timeoutMs: 30000 },
};

function keyInput(
  overrides: { reader?: ReaderSpec; gradeName?: string; sha?: string; repetition?: number } = {},
): ReadingCacheKeyInput {
  const reader = overrides.reader ?? READER;
  const rendered = renderTranscriptionPrompt(reader, FORMAT, {
    gradeName: overrides.gradeName ?? '6° Básico',
  });
  return {
    reader,
    prompt: rendered.prompt,
    outputJsonSchema: rendered.outputSchema,
    imageSha256: overrides.sha ?? 'a'.repeat(64),
    repetition: overrides.repetition ?? 0,
  };
}

function okResult(literal: string): TranscriptionResult {
  return {
    status: 'ok',
    output: fakeOutput(literal),
    rawText: null,
    providerModel: READER.model,
    usage: null,
    costUsd: 0.001,
    latencyMs: 1200,
    errorCode: null,
  };
}

describe('caché de lecturas', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'answer-reading-cache-spec-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('la clave es la misma para el mismo lector, prompt, imagen y repetición, sin importar el orden de los parámetros', () => {
    const reordered: ReaderSpec = {
      ...READER,
      key: 'otra-etiqueta',
      family: 'otra-familia',
      params: {
        timeoutMs: 30000,
        mediaResolution: 'medium',
        reasoning: 'off',
        maxOutputTokens: 2048,
      },
    };
    expect(readingCacheKey(keyInput({ reader: reordered }))).toBe(readingCacheKey(keyInput()));
  });

  it('la clave cambia con el modelo, los parámetros, el prompt renderizado, la imagen o la repetición', () => {
    const base = readingCacheKey(keyInput());
    const variants = [
      keyInput({ reader: { ...READER, model: 'gemini-3.5-flash-lite' } }),
      keyInput({ reader: { ...READER, provider: 'openai' } }),
      keyInput({ reader: { ...READER, params: { ...READER.params, reasoning: 'low' } } }),
      keyInput({ reader: { ...READER, params: { ...READER.params, maxOutputTokens: 4096 } } }),
      keyInput({ reader: { ...READER, hints: 'format' } }),
      keyInput({ gradeName: '5° Básico' }),
      keyInput({ sha: 'b'.repeat(64) }),
      keyInput({ repetition: 1 }),
    ].map(readingCacheKey);
    expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
  });

  it('guarda y recupera una lectura; una clave distinta es un fallo', async () => {
    const cache = new ReadingCache(dir, 'use');
    const input = keyInput();
    const key = readingCacheKey(input);
    const rendered = renderTranscriptionPrompt(READER, FORMAT, { gradeName: '6° Básico' });
    expect(await cache.get(key)).toBeNull();
    await cache.put(cachedReadingEntry(key, input, rendered.prompt, okResult('48'), 'api'));
    expect(await cache.has(key)).toBe(true);
    expect((await cache.get(key))?.result.output?.literal).toBe('48');
    expect(await cache.get(readingCacheKey(keyInput({ repetition: 2 })))).toBeNull();
    expect(cache.stats).toEqual({ hits: 1, misses: 2, writes: 1 });
  });

  it('no guarda fallas del proveedor', async () => {
    const cache = new ReadingCache(dir, 'use');
    const input = keyInput();
    const key = readingCacheKey(input);
    const rendered = renderTranscriptionPrompt(READER, FORMAT, { gradeName: '6° Básico' });
    const failed: TranscriptionResult = {
      ...okResult(''),
      status: 'timeout',
      output: null,
      errorCode: 'timeout',
    };
    expect(await cache.put(cachedReadingEntry(key, input, rendered.prompt, failed, 'api'))).toBe(
      false,
    );
    expect(await cache.has(key)).toBe(false);
  });

  it('anota en el registro cada llamada, también las fallidas, y nada con --no-cache', async () => {
    const input = keyInput();
    const key = readingCacheKey(input);
    const rendered = renderTranscriptionPrompt(READER, FORMAT, { gradeName: '6° Básico' });
    const failed: TranscriptionResult = {
      ...okResult(''),
      status: 'timeout',
      output: null,
      errorCode: 'timeout',
    };
    const cache = new ReadingCache(dir, 'use');
    await cache.put(cachedReadingEntry(key, input, rendered.prompt, okResult('48'), 'api'));
    await cache.put(cachedReadingEntry(key, input, rendered.prompt, failed, 'api'));
    await new ReadingCache(dir, 'off').put(
      cachedReadingEntry(key, input, rendered.prompt, okResult('48'), 'api'),
    );
    const lines = (await readFile(join(dir, CALL_LEDGER_FILE), 'utf8')).trim().split('\n');
    const calls = lines.map(
      (line) => JSON.parse(line) as { key: string; result: TranscriptionResult },
    );
    expect(calls.map((call) => call.result.status)).toEqual(['ok', 'timeout']);
    expect(calls[1]?.result.errorCode).toBe('timeout');
    expect(calls[1]?.result.costUsd).toBe(0.001);
    expect(calls.every((call) => call.key === key)).toBe(true);
  });

  it('--refresh no lee pero reescribe; --no-cache ni lee ni escribe', async () => {
    const input = keyInput();
    const key = readingCacheKey(input);
    const rendered = renderTranscriptionPrompt(READER, FORMAT, { gradeName: '6° Básico' });
    const entry = cachedReadingEntry(key, input, rendered.prompt, okResult('48'), 'api');
    const off = new ReadingCache(dir, 'off');
    expect(await off.put(entry)).toBe(false);
    const refresh = new ReadingCache(dir, 'refresh');
    expect(await refresh.put(entry)).toBe(true);
    expect(await refresh.get(key)).toBeNull();
    expect(await new ReadingCache(dir, 'use').get(key)).not.toBeNull();
  });
});
