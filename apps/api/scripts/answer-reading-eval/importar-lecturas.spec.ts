import { fakeOutput, renderTranscriptionPrompt } from '@soe/answer-reading';
import type { ReaderSpec, ResponseFormat } from '@soe/types';
import type { PreparedSample } from './dataset';
import { verdictFor, type ExperimentReading, type ImportContext } from './importar-lecturas';

const FORMAT: ResponseFormat = { kind: 'integer', maxChars: 4, allowNegative: false };
const IMAGE_SHA = 'a'.repeat(64);
const GRADE = '6° Básico';

const READER: ReaderSpec = {
  key: 'gemini-3.8-flash',
  transcriberId: 'llm',
  provider: 'gemini',
  family: 'gemini-flash',
  model: 'gemini-3.8-flash',
  promptRef: 'transcribe.short-answer@2',
  hints: 'none',
  params: { maxOutputTokens: 2048, reasoning: 'off', mediaResolution: 'medium', timeoutMs: 30000 },
};

const SAMPLE = {
  sample: { id: 'entero', format: FORMAT, gradeName: GRADE },
} as unknown as PreparedSample;

const RENDERED = renderTranscriptionPrompt(READER, FORMAT, { gradeName: GRADE }).prompt;

function reading(overrides: Partial<ExperimentReading> = {}): ExperimentReading {
  return {
    key: 'k',
    candidate: 'flash',
    rep: 0,
    crop: 'entero.png',
    formatKind: 'integer',
    reader: READER,
    promptRef: READER.promptRef,
    status: 'ok',
    errorCode: null,
    providerModel: READER.model,
    output: fakeOutput('108'),
    rawText: null,
    normalized: null,
    usage: null,
    costUsd: 0.001,
    latencyMs: 900,
    ...overrides,
  };
}

function context(force = false): ImportContext {
  return {
    sampleByImageSha: new Map([[IMAGE_SHA, SAMPLE]]),
    imageShaOf: async () => IMAGE_SHA,
    source: 'import:prueba',
    force,
  };
}

describe('importar lecturas pagadas al caché', () => {
  it('sin el prompt ni su hash guardados no importa salvo con --force', async () => {
    expect(await verdictFor(reading(), context())).toEqual({
      kind: 'skip',
      reason: 'sin el prompt ni su hash guardados (usa --force para importar sin ese control)',
    });
    expect((await verdictFor(reading(), context(true))).kind).toBe('import');
  });

  it('importa si el hash guardado es el del prompt que se renderiza hoy', async () => {
    expect((await verdictFor(reading({ promptHash: RENDERED.hash }), context())).kind).toBe(
      'import',
    );
  });

  it('omite la lectura si el hash del prompt cambió, aun con --force', async () => {
    for (const force of [false, true]) {
      expect(await verdictFor(reading({ promptHash: 'f'.repeat(64) }), context(force))).toEqual({
        kind: 'skip',
        reason: 'el prompt renderizado cambió desde el experimento',
      });
    }
  });

  it('con el texto del prompt guardado compara system y user', async () => {
    const same = { system: RENDERED.system, user: RENDERED.user };
    expect((await verdictFor(reading({ prompt: same }), context())).kind).toBe('import');
    expect(
      await verdictFor(reading({ prompt: { ...same, user: `${same.user} ` } }), context()),
    ).toEqual({ kind: 'skip', reason: 'el prompt renderizado cambió desde el experimento' });
  });
});
