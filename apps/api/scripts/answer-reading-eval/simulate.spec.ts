import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FakeTranscriber,
  fakeOutput,
  fakeVerdict,
  type FakeReading,
  type FakeVerdict,
  type TranscriptionResult,
} from '@soe/answer-reading';
import type { ConsensusResult, ReaderSpec, TranscriptionOutput } from '@soe/types';
import { loadDataset, type DatasetManifest } from './dataset';
import { renderAnswerBox } from './generar-fixtures';
import { computeMetrics } from './metrics';
import { ReadingCache } from './reading-cache';
import { loadRouteSet, parseReaderMinConfidence, type RouteSet } from './route-set';
import { applyReaderMinConfidence, runSimulation, type HarnessTranscriber } from './simulate';

const ACTUAL_ROUTES = join(__dirname, 'routes', 'actual.json');
const HAIKU = 'claude-haiku-5-5';
const FLASH_LITE = 'gemini-3.5-flash-lite';
const DEFAULT_ROUTE_ID = '7ead0000-0000-4000-8000-000000000001';
const SEQUENCE_ROUTE_ID = '7ead0000-0000-4000-8000-000000000007';
const FREE_TEXT_ROUTE_ID = '7ead0000-0000-4000-8000-000000000005';

const SAMPLES = {
  entero: { image: 'entero.png', drawn: '100' },
  decimal: { image: 'decimal.png', drawn: '2,73' },
  secuencia: { image: 'secuencia.png', drawn: '8 10 12' },
  desarrollo: { image: 'desarrollo.png', drawn: '40 + 7' },
} as const;

type SampleId = keyof typeof SAMPLES;

const MANIFEST: DatasetManifest = {
  manifestVersion: 2,
  name: 'spec-rutas',
  datasetVersion: '1',
  samples: [
    {
      id: 'entero',
      image: SAMPLES.entero.image,
      format: { kind: 'integer', maxChars: 4, allowNegative: false },
      label: { state: 'answered', literal: '100', canonical: 'n:100' },
      item: {
        id: '51e70000-0000-0000-0000-000000001002',
        type: 'short_answer',
        content: { prompt: '25 × 4', comparison: 'numeric', acceptedAnswers: ['100'] },
        scoringConfig: { points: 1 },
      },
      student: 'Ámbar',
      question: 2,
    },
    {
      id: 'decimal',
      image: SAMPLES.decimal.image,
      format: { kind: 'decimal', maxChars: 6, allowNegative: false },
      label: { state: 'answered', literal: '2,73', canonical: 'n:273/100' },
      item: {
        id: '51e70000-0000-0000-0000-000000001003',
        type: 'short_answer',
        content: { prompt: '2,5 + 1,25', comparison: 'numeric', acceptedAnswers: ['3,75'] },
        scoringConfig: { points: 1 },
      },
    },
    {
      id: 'secuencia',
      image: SAMPLES.secuencia.image,
      format: { kind: 'sequence', length: 3 },
      label: {
        state: 'answered',
        literal: '8, 10, 12',
        canonical: 's:8|10|12',
        parts: { e1: '8', e2: '10', e3: '12' },
      },
      item: {
        id: '51e70000-0000-0000-0000-000000001005',
        type: 'short_answer',
        content: { prompt: '2, 4, 6', comparison: 'sequence', acceptedAnswers: ['8, 10, 12'] },
        scoringConfig: { points: 1 },
      },
    },
    {
      id: 'desarrollo',
      image: SAMPLES.desarrollo.image,
      format: { kind: 'free_text', lines: 4 },
      label: { state: 'answered', literal: '47 tiene 4 decenas' },
    },
  ],
};

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

const SHA: Record<SampleId, string> = {
  entero: sha256(renderAnswerBox(SAMPLES.entero.drawn)),
  decimal: sha256(renderAnswerBox(SAMPLES.decimal.drawn)),
  secuencia: sha256(renderAnswerBox(SAMPLES.secuencia.drawn)),
  desarrollo: sha256(renderAnswerBox(SAMPLES.desarrollo.drawn)),
};

function reading(literal: string, confidence: number, parts?: Record<string, string>) {
  return fakeOutput(literal, { confidence, ...(parts ? { parts } : {}) });
}

function perfectReadings(confidence = 0.99): Record<SampleId, TranscriptionOutput> {
  return {
    entero: reading('100', confidence),
    decimal: reading('2,73', confidence),
    secuencia: reading('8, 10, 12', confidence, { e1: '8', e2: '10', e3: '12' }),
    desarrollo: reading('47 tiene 4 decenas', confidence),
  };
}

function bySample<T>(
  byReader: Record<string, Partial<Record<SampleId, T>>>,
): Record<string, Record<string, T>> {
  const bySha: Record<string, Record<string, T>> = {};
  for (const [readerKey, values] of Object.entries(byReader)) {
    bySha[readerKey] = {};
    for (const [id, value] of Object.entries(values)) {
      if (value) bySha[readerKey]![SHA[id as SampleId]] = value;
    }
  }
  return bySha;
}

function fakeFor(
  byReader: Record<string, Partial<Record<SampleId, FakeReading>>>,
  verdicts: Record<string, Partial<Record<SampleId, FakeVerdict>>> = {},
): FakeTranscriber {
  return new FakeTranscriber({
    id: 'llm',
    byReader: bySample(byReader),
    verdicts: bySample(verdicts),
  });
}

const VERIFIER: ReaderSpec = {
  key: 'verificador',
  transcriberId: 'llm',
  provider: 'openai',
  family: 'openai-luna',
  model: 'gpt-6-luna',
  promptRef: 'verify.incorrect@1',
  hints: 'format',
  minConfidence: 0.9,
  params: { maxOutputTokens: 1024, reasoning: 'low', timeoutMs: 30000 },
};

function withVerifier(routeSet: RouteSet): RouteSet {
  return {
    ...routeSet,
    routes: routeSet.routes.map((route) => ({
      ...route,
      policy: { ...route.policy, incorrectVerifier: VERIFIER },
    })),
  };
}

describe('simulación del arnés con rutas por formato', () => {
  let dir: string;
  let routeSet: RouteSet;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'answer-reading-sim-spec-'));
    await Promise.all(
      Object.values(SAMPLES).map((sample) =>
        writeFile(join(dir, sample.image), renderAnswerBox(sample.drawn)),
      ),
    );
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(MANIFEST), 'utf8');
    routeSet = await loadRouteSet(ACTUAL_ROUTES);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function simulate(
    transcriber: HarnessTranscriber,
    options: { thresholds?: string; cache?: ReadingCache; repetitions?: number } = {},
  ) {
    const dataset = await loadDataset(dir);
    return runSimulation({
      samples: dataset.samples,
      routeSet,
      repetitions: options.repetitions ?? 1,
      concurrency: 2,
      readerMinConfidence: options.thresholds ? parseReaderMinConfidence(options.thresholds) : null,
      transcriberFor: () => transcriber,
      cache: options.cache ?? new ReadingCache(null, 'off'),
      budget: null,
    });
  }

  it('elige la ruta de cada muestra con resolveReadingRoute según su formato', async () => {
    const perfect = perfectReadings();
    const fake = fakeFor({ [HAIKU]: perfect, [FLASH_LITE]: perfect });
    const result = await simulate(fake);
    const routeOf = Object.fromEntries(result.units.map((unit) => [unit.sampleId, unit.routeId]));
    expect(routeOf).toEqual({
      entero: DEFAULT_ROUTE_ID,
      decimal: DEFAULT_ROUTE_ID,
      secuencia: SEQUENCE_ROUTE_ID,
      desarrollo: FREE_TEXT_ROUTE_ID,
    });
    const calls = fake.calls.map((call) => ({
      sha: call.image.sha256,
      reader: call.reader.key,
      prompt: call.prompt.ref,
      hints: call.reader.hints,
    }));
    expect(calls.filter((call) => call.sha === SHA.secuencia).map((call) => call.hints)).toEqual([
      'format',
      'format',
    ]);
    expect(calls.filter((call) => call.sha === SHA.entero).map((call) => call.hints)).toEqual([
      'none',
      'none',
    ]);
    expect(calls.filter((call) => call.sha === SHA.desarrollo)).toEqual([
      { sha: SHA.desarrollo, reader: HAIKU, prompt: 'transcribe.free-text@1', hints: 'none' },
    ]);
    expect(result.units.filter((unit) => unit.autoAccepted).map((unit) => unit.sampleId)).toEqual([
      'entero',
      'decimal',
      'secuencia',
    ]);
  });

  it('separa las autoaceptadas equivocadas que perjudican al alumno de las que lo favorecen', async () => {
    const wrong = {
      ...perfectReadings(),
      entero: reading('101', 0.99),
      decimal: reading('3,75', 0.99),
    };
    const result = await simulate(fakeFor({ [HAIKU]: wrong, [FLASH_LITE]: wrong }));
    const unitOf = (id: string) => result.units.find((unit) => unit.sampleId === id);
    expect(unitOf('entero')).toMatchObject({
      autoAccepted: true,
      decisionCorrect: false,
      acceptedPoints: 0,
      expectedPoints: 1,
      pointsDelta: -1,
      autoAcceptedError: 'harms',
    });
    expect(unitOf('decimal')).toMatchObject({
      autoAccepted: true,
      acceptedPoints: 1,
      expectedPoints: 0,
      pointsDelta: 1,
      autoAcceptedError: 'favors',
    });
    expect(unitOf('secuencia')?.autoAcceptedError).toBeNull();
    const metrics = computeMetrics(result, { hits: 0 });
    expect(metrics.short.harmsStudent).toEqual({ count: 1, points: -1 });
    expect(metrics.short.favorsStudent).toEqual({ count: 1, points: 1 });
    expect(metrics.short.autoAcceptedWrong).toMatchObject({ count: 2, total: 3 });
    expect(metrics.short.errors.map((error) => [error.sampleId, error.kind])).toEqual([
      ['entero', 'harms'],
      ['decimal', 'favors'],
    ]);
    const haiku = metrics.readers.find((reader) => reader.readerKey === HAIKU);
    expect(haiku?.short?.exact).toMatchObject({ count: 1, total: 3 });
    expect(haiku?.development?.fidelityMean).toBe(1);
  });

  it('el umbral por lector manda a revisión lo que la ruta autoaceptaría y usa el de la ruta para el resto', async () => {
    const readings = perfectReadings(0.95);
    const fake = fakeFor({ [HAIKU]: readings, [FLASH_LITE]: readings });
    const plain = await simulate(fake);
    expect(plain.units.filter((unit) => unit.autoAccepted)).toHaveLength(3);

    const strict = await simulate(fake, { thresholds: `${FLASH_LITE}=0.97` });
    const shortUnits = strict.units.filter((unit) => unit.group === 'short');
    expect(shortUnits.every((unit) => unit.outcome === 'needs_review')).toBe(true);
    expect(shortUnits.every((unit) => unit.reasons[0] === 'low_confidence')).toBe(true);
    expect(shortUnits.every((unit) => unit.readerThresholdApplied)).toBe(true);

    const loose = await simulate(fake, { thresholds: `${FLASH_LITE}=0.90` });
    expect(loose.units.filter((unit) => unit.autoAccepted)).toHaveLength(3);

    const haikuLow = { ...readings, entero: reading('100', 0.8) };
    const mixed = await simulate(fakeFor({ [HAIKU]: haikuLow, [FLASH_LITE]: readings }), {
      thresholds: `${FLASH_LITE}=0.90`,
    });
    expect(mixed.units.find((unit) => unit.sampleId === 'entero')).toMatchObject({
      outcome: 'needs_review',
      readerThresholdApplied: true,
    });
  });

  it('el umbral que el lector trae en la ruta llega al consenso y el override lo reemplaza', async () => {
    const readings = perfectReadings(0.95);
    const fake = fakeFor({ [HAIKU]: readings, [FLASH_LITE]: readings });
    const withReaderThreshold = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(withReaderThreshold);
      if (value === null || typeof value !== 'object') return value;
      const entries = Object.entries(value).map(([key, inner]) => [
        key,
        withReaderThreshold(inner),
      ]);
      const record = Object.fromEntries(entries) as Record<string, unknown>;
      return record['key'] === FLASH_LITE && 'promptRef' in record
        ? { ...record, minConfidence: 0.97 }
        : record;
    };
    const strictRoutes = withReaderThreshold(routeSet) as RouteSet;
    const dataset = await loadDataset(dir);
    const result = await runSimulation({
      samples: dataset.samples,
      routeSet: strictRoutes,
      repetitions: 1,
      concurrency: 2,
      readerMinConfidence: null,
      transcriberFor: () => fake,
      cache: new ReadingCache(null, 'off'),
      budget: null,
    });
    const shortUnits = result.units.filter((unit) => unit.group === 'short');
    expect(shortUnits.every((unit) => unit.outcome === 'needs_review')).toBe(true);
    expect(shortUnits.every((unit) => unit.reasons.includes('low_confidence'))).toBe(true);

    const overridden = await runSimulation({
      samples: dataset.samples,
      routeSet: strictRoutes,
      repetitions: 1,
      concurrency: 2,
      readerMinConfidence: parseReaderMinConfidence(`${FLASH_LITE}=0.90`),
      transcriberFor: () => fake,
      cache: new ReadingCache(null, 'off'),
      budget: null,
    });
    expect(overridden.units.filter((unit) => unit.autoAccepted)).toHaveLength(3);
  });

  it('una segunda corrida sale entera del caché sin llamar al transcriptor', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'answer-reading-sim-cache-'));
    try {
      const perfect = perfectReadings();
      const first = await simulate(fakeFor({ [HAIKU]: perfect, [FLASH_LITE]: perfect }), {
        cache: new ReadingCache(cacheDir, 'use'),
        repetitions: 2,
      });
      expect(first.apiCalls).toBe(14);
      const throwing: HarnessTranscriber = {
        id: 'llm',
        supports: () => true,
        transcribe: (): Promise<TranscriptionResult> => {
          throw new Error('no debería llamar a la API');
        },
      };
      const cache = new ReadingCache(cacheDir, 'use');
      const second = await simulate(throwing, { cache, repetitions: 2 });
      expect(second.apiCalls).toBe(0);
      expect(cache.stats.hits).toBe(14);
      expect(second.units).toEqual(first.units.map((unit) => ({ ...unit })));
      expect(second.readings.every((record) => record.fromCache)).toBe(true);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});

describe('verificador de incorrectas en el arnés', () => {
  let dir: string;
  let routeSet: RouteSet;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'answer-reading-verifier-spec-'));
    await Promise.all(
      Object.values(SAMPLES).map((sample) =>
        writeFile(join(dir, sample.image), renderAnswerBox(sample.drawn)),
      ),
    );
    const entero = MANIFEST.samples[0]!;
    const manifest: DatasetManifest = {
      ...MANIFEST,
      samples: [
        ...MANIFEST.samples,
        { ...entero, id: 'entero-leido-108', injectedReading: { literal: '108' } },
      ],
    };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
    routeSet = withVerifier(await loadRouteSet(ACTUAL_ROUTES));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function simulate(transcriber: HarnessTranscriber, cache = new ReadingCache(null, 'off')) {
    const dataset = await loadDataset(dir);
    return runSimulation({
      samples: dataset.samples,
      routeSet,
      repetitions: 1,
      concurrency: 2,
      readerMinConfidence: null,
      transcriberFor: () => transcriber,
      cache,
      budget: null,
    });
  }

  const misread = { ...perfectReadings(), entero: reading('101', 0.99) };

  it('manda a revisión el 0 injusto que atrapa, deja la incorrecta verdadera y no toca las correctas', async () => {
    const fake = fakeFor(
      { [HAIKU]: misread, [FLASH_LITE]: misread },
      { verificador: { entero: fakeVerdict(true, 0.95), decimal: fakeVerdict(false, 0.95) } },
    );

    const result = await simulate(fake);

    const unitOf = (id: string) => result.units.find((unit) => unit.sampleId === id);
    expect(unitOf('entero')).toMatchObject({
      outcome: 'needs_review',
      reasons: ['verifier_flagged'],
      autoAcceptedError: null,
      beforeVerifier: { outcome: 'auto_accepted', autoAcceptedError: 'harms' },
      verifier: { couldBeKey: true, flagged: true },
    });
    expect(unitOf('decimal')).toMatchObject({
      outcome: 'auto_accepted',
      verifier: { couldBeKey: false, flagged: false },
    });
    expect(unitOf('secuencia')?.verifier).toBeNull();
    const verifier = computeMetrics(result, { hits: 0 }).verifier;
    expect(verifier).toMatchObject({
      checked: 3,
      unfairZeros: { before: 2, caught: { count: 2, total: 2 } },
      falseAlarms: { count: 0, total: 1 },
      autoAcceptedIncorrect: { before: 3, after: 1 },
      harmsStudent: { before: 2, after: 0 },
    });
  });

  it('una lectura inyectada no llama a los lectores y se verifica con esa lectura', async () => {
    const fake = fakeFor({ [HAIKU]: perfectReadings(), [FLASH_LITE]: perfectReadings() });

    const result = await simulate(fake);

    const injected = result.units.find((unit) => unit.sampleId === 'entero-leido-108');
    expect(injected).toMatchObject({
      injected: true,
      canonical: 'n:108',
      outcome: 'needs_review',
      reasons: ['verifier_failed'],
      verifier: { status: 'error', errorCode: 'fake_missing' },
    });
    expect(result.readings.filter((record) => record.sampleId === 'entero-leido-108')).toEqual([]);
    const verifyCall = fake.verifyCalls.find((call) => call.prompt.user.includes('108'));
    expect(verifyCall?.prompt.user).toContain('- 100');
  });

  it('estrés del escalamiento: la lectura inyectada dudosa pasa por el lector fuerte y luego por el verificador', async () => {
    const strong: ReaderSpec = {
      key: 'fuerte',
      transcriberId: 'llm',
      provider: 'openai',
      family: 'openai-sol',
      model: 'gpt-6.1-sol',
      promptRef: 'transcribe.short-answer@2',
      hints: 'none',
      minConfidence: 0.9,
      params: { maxOutputTokens: 4096, reasoning: 'low', timeoutMs: 90000 },
    };
    const escalation: RouteSet = {
      ...routeSet,
      routes: routeSet.routes.map((route) => ({
        ...route,
        policy: {
          ...route.policy,
          onDisagreement: 'tiebreak_reader',
          tiebreakReader: { ...strong, promptRef: route.readers[0]!.promptRef },
          tiebreakOn: ['readers_disagree', 'low_confidence', 'reader_requested_review'],
          tiebreakAgreeWith: 'other_provider',
        },
      })),
    };
    const doubtful = { ...perfectReadings(), entero: reading('100', 0.5) };
    const fake = () =>
      fakeFor(
        {
          [HAIKU]: doubtful,
          [FLASH_LITE]: perfectReadings(),
          fuerte: { entero: reading('108', 0.95) },
        },
        { verificador: { entero: fakeVerdict(true, 0.95) } },
      );
    const dataset = await loadDataset(dir);
    const run = (injectedEscalation: boolean) =>
      runSimulation({
        samples: dataset.samples,
        routeSet: escalation,
        repetitions: 1,
        concurrency: 2,
        readerMinConfidence: null,
        transcriberFor: fake,
        cache: new ReadingCache(null, 'off'),
        budget: null,
        injectedEscalation,
      });

    const stressed = await run(true);
    const unitOf = (result: typeof stressed, id: string) =>
      result.units.find((unit) => unit.sampleId === id);
    expect(unitOf(stressed, 'entero')).toMatchObject({
      outcome: 'needs_review',
      reasons: ['low_confidence'],
      usedTiebreak: true,
    });
    expect(unitOf(stressed, 'entero-leido-108')).toMatchObject({
      injected: true,
      usedTiebreak: true,
      outcome: 'needs_review',
      reasons: ['verifier_flagged'],
      beforeVerifier: { outcome: 'auto_accepted', autoAcceptedError: 'harms' },
    });

    const plain = await run(false);
    expect(unitOf(plain, 'entero-leido-108')).toMatchObject({
      injected: true,
      usedTiebreak: false,
    });
  });

  it('el veredicto se guarda en el caché y la segunda corrida no vuelve a llamar', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'answer-reading-verifier-cache-'));
    try {
      const verdicts = { verificador: { entero: fakeVerdict(true, 0.95) } };
      const first = fakeFor({ [HAIKU]: misread, [FLASH_LITE]: misread }, verdicts);
      await simulate(first, new ReadingCache(cacheDir, 'use'));
      const second = fakeFor({ [HAIKU]: misread, [FLASH_LITE]: misread }, verdicts);
      const rerun = await simulate(second, new ReadingCache(cacheDir, 'use'));
      expect(second.verifyCalls.filter((call) => call.image.sha256 === SHA.entero)).toEqual([]);
      expect(rerun.units.find((unit) => unit.sampleId === 'entero')?.verifier).toMatchObject({
        fromCache: true,
        flagged: true,
      });
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});

describe('applyReaderMinConfidence', () => {
  const reader = (key: string): ReaderSpec => ({
    key,
    transcriberId: 'llm',
    provider: 'gemini',
    family: key,
    model: key,
    promptRef: 'transcribe.short-answer@2',
    hints: 'none',
    params: { maxOutputTokens: 2048, reasoning: 'off', timeoutMs: 30000 },
  });
  const run = (key: string, confidence: number) => ({
    reader: reader(key),
    role: 'primary' as const,
    result: {
      status: 'ok' as const,
      output: fakeOutput('100', { confidence }),
      rawText: null,
      providerModel: key,
      usage: null,
      costUsd: 0,
      latencyMs: 0,
      errorCode: null,
    },
  });
  const accepted: ConsensusResult = {
    outcome: 'auto_accepted',
    value: null,
    scoringOutcome: 'correct',
    reasons: [],
    reviewMode: null,
    usedReadingIds: ['a', 'b'],
    policyId: 'short-answer-default',
    policyVersion: 1,
  };

  it('no toca la decisión si todos superan su umbral', () => {
    const adjusted = applyReaderMinConfidence(
      accepted,
      [run('a', 0.98), run('b', 0.86)],
      { a: 0.97 },
      0.85,
    );
    expect(adjusted).toEqual({ result: accepted, applied: false });
  });

  it('pasa a revisión de lectura con low_confidence si un lector queda bajo su umbral', () => {
    const adjusted = applyReaderMinConfidence(
      accepted,
      [run('a', 0.96), run('b', 0.99)],
      { a: 0.97 },
      0.85,
    );
    expect(adjusted.applied).toBe(true);
    expect(adjusted.result).toMatchObject({
      outcome: 'needs_review',
      reasons: ['low_confidence'],
      reviewMode: 'reading',
    });
  });

  it('a una casilla que ya iba a revisión solo le agrega el motivo', () => {
    const review: ConsensusResult = {
      ...accepted,
      outcome: 'needs_review',
      reasons: ['readers_disagree'],
      reviewMode: 'reading',
    };
    const adjusted = applyReaderMinConfidence(review, [run('a', 0.5)], {}, 0.85);
    expect(adjusted.result.outcome).toBe('needs_review');
    expect(adjusted.result.reasons).toEqual(['low_confidence', 'readers_disagree']);
  });
});
