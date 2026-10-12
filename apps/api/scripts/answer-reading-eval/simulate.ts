import {
  evaluateConsensus,
  isTranscriptionPromptFor,
  needsTiebreak,
  normalizeTranscription,
  readingKeyFor,
  renderTranscriptionPrompt,
  transcriptionZodSchema,
  type ConsensusReading,
  type ResolvedRouteWithFallback,
  type TranscriptionRequest,
  type TranscriptionResult,
} from '@soe/answer-reading';
import type {
  ConsensusPolicy,
  ConsensusResult,
  ReaderSpec,
  ReadingOutcome,
  ReadingState,
  ResponseFormat,
  ResponseFormatKind,
  ReviewMode,
  ReviewReason,
  ScoringOutcome,
  TranscriptionStatus,
} from '@soe/types';
import type { PreparedSample, SampleGroup } from './dataset';
import {
  ReadingCache,
  cachedReadingEntry,
  readingCacheKey,
  type ReadingCacheKeyInput,
} from './reading-cache';
import { resolveSampleRoute, type ReaderMinConfidence, type RouteSet } from './route-set';
import { textSimilarity } from './statistics';

export interface HarnessTranscriptionRequest extends TranscriptionRequest {
  readonly format: ResponseFormat;
}

export interface HarnessTranscriber {
  readonly id: string;
  supports(reader: ReaderSpec): boolean;
  transcribe(request: HarnessTranscriptionRequest): Promise<TranscriptionResult>;
}

export interface SimulationBudget {
  readonly limitUsd: number;
  estimateCallUsd(reader: ReaderSpec, observedUsd: readonly number[]): number;
}

export type SkipReason =
  | 'image_error'
  | 'unsupported_format'
  | 'no_route'
  | 'prompt_unsupported_format';

export type AutoAcceptedErrorKind = 'harms' | 'favors' | 'neutral';

export type ReaderRole = 'primary' | 'tiebreak';

export interface ReadingRecord {
  readonly sampleId: string;
  readonly repetition: number;
  readonly group: SampleGroup;
  readonly formatKind: ResponseFormatKind;
  readonly readerKey: string;
  readonly provider: string;
  readonly model: string;
  readonly family: string;
  readonly promptRef: string;
  readonly hints: ReaderSpec['hints'];
  readonly role: ReaderRole;
  readonly cacheKey: string;
  readonly fromCache: boolean;
  readonly cacheSource: string | null;
  readonly status: TranscriptionStatus;
  readonly errorCode: string | null;
  readonly state: ReadingState | null;
  readonly literal: string | null;
  readonly parts: Readonly<Record<string, string>> | null;
  readonly canonical: string | null;
  readonly confidence: number | null;
  readonly reviewRequested: boolean | null;
  readonly exact: boolean | null;
  readonly fidelity: number | null;
  readonly costUsd: number | null;
  readonly latencyMs: number;
}

export interface UnitRecord {
  readonly sampleId: string;
  readonly repetition: number;
  readonly group: SampleGroup;
  readonly formatKind: ResponseFormatKind;
  readonly routeId: string;
  readonly routeVersion: number;
  readonly routeLevel: string;
  readonly outcome: ReadingOutcome;
  readonly autoAccepted: boolean;
  readonly reasons: readonly ReviewReason[];
  readonly reviewMode: ReviewMode | null;
  readonly readerThresholdApplied: boolean;
  readonly canonical: string | null;
  readonly valueState: ReadingState | null;
  readonly decisionCorrect: boolean;
  readonly scoringOutcome: ScoringOutcome | null;
  readonly acceptedPoints: number | null;
  readonly expectedPoints: number | null;
  readonly pointsDelta: number | null;
  readonly autoAcceptedError: AutoAcceptedErrorKind | null;
  readonly usedTiebreak: boolean;
  readonly costUsd: number;
  readonly latencyMs: number;
}

export interface SampleRecord {
  readonly id: string;
  readonly image: string;
  readonly student: string | null;
  readonly question: string | number | null;
  readonly formatKind: ResponseFormatKind;
  readonly group: SampleGroup;
  readonly truth: { state: ReadingState; literal: string; canonical: string | null };
  readonly expectedOutcome: ScoringOutcome | null;
  readonly expectedPoints: number | null;
  readonly maxPoints: number;
  readonly scoringFormatKind: ResponseFormatKind | null;
  readonly routeId: string | null;
  readonly skipped: SkipReason | null;
  readonly skipDetail: string | null;
}

export interface SimulationOptions {
  readonly samples: readonly PreparedSample[];
  readonly routeSet: RouteSet;
  readonly repetitions: number;
  readonly concurrency: number;
  readonly readerMinConfidence: ReaderMinConfidence | null;
  readonly transcriberFor: (reader: ReaderSpec) => HarnessTranscriber | null;
  readonly cache: ReadingCache;
  readonly budget: SimulationBudget | null;
  readonly cacheSource?: string;
  readonly onUnitDone?: (progress: { done: number; total: number; spentUsd: number }) => void;
}

export interface SimulationResult {
  readonly samples: SampleRecord[];
  readonly units: UnitRecord[];
  readonly readings: ReadingRecord[];
  readonly spentUsd: number;
  readonly apiCalls: number;
  readonly stoppedByBudget: boolean;
}

interface PlannedSample {
  readonly prepared: PreparedSample;
  readonly route: ResolvedRouteWithFallback | null;
  readonly skip: { reason: SkipReason; detail: string } | null;
}

export interface PlannedReading {
  readonly sampleId: string;
  readonly repetition: number;
  readonly reader: ReaderSpec;
  readonly role: ReaderRole;
  readonly cacheKey: string;
}

interface ReaderRun {
  readonly reader: ReaderSpec;
  readonly role: ReaderRole;
  readonly cacheKey: string;
  readonly fromCache: boolean;
  readonly cacheSource: string | null;
  readonly result: TranscriptionResult;
}

const AUTO_OUTCOMES: ReadonlySet<ReadingOutcome> = new Set(['auto_accepted', 'auto_blank']);

function skipFor(
  prepared: PreparedSample,
  route: ResolvedRouteWithFallback | null,
): { reason: SkipReason; detail: string } | null {
  const { sample } = prepared;
  if (prepared.image === null) {
    return { reason: 'image_error', detail: prepared.imageError ?? 'Sin imagen' };
  }
  if (prepared.group === 'unsupported') {
    return {
      reason: 'unsupported_format',
      detail: `El formato ${sample.format.kind} todavía no está en el registro`,
    };
  }
  if (route === null) {
    return { reason: 'no_route', detail: `Ninguna ruta activa atiende ${sample.format.kind}` };
  }
  const readers = route.policy.tiebreakReader
    ? [...route.readers, route.policy.tiebreakReader]
    : route.readers;
  const unsupported = readers.find(
    (reader) => !isTranscriptionPromptFor(reader.promptRef, sample.format.kind),
  );
  if (unsupported) {
    return {
      reason: 'prompt_unsupported_format',
      detail: `El prompt ${unsupported.promptRef} no atiende el formato ${sample.format.kind}`,
    };
  }
  return null;
}

export function planSamples(
  samples: readonly PreparedSample[],
  routeSet: RouteSet,
): PlannedSample[] {
  return samples.map((prepared) => {
    const route =
      prepared.group === 'unsupported' ? null : resolveSampleRoute(routeSet, prepared.context);
    return { prepared, route, skip: skipFor(prepared, route) };
  });
}

function keyInputFor(
  prepared: PreparedSample,
  reader: ReaderSpec,
  repetition: number,
): { keyInput: ReadingCacheKeyInput; rendered: ReturnType<typeof renderTranscriptionPrompt> } {
  const rendered = renderTranscriptionPrompt(reader, prepared.sample.format, {
    gradeName: prepared.sample.gradeName ?? null,
  });
  return {
    rendered,
    keyInput: {
      reader,
      prompt: rendered.prompt,
      outputJsonSchema: rendered.outputSchema,
      imageSha256: prepared.image?.sha256 ?? '',
      repetition,
    },
  };
}

export function planReadings(
  planned: readonly PlannedSample[],
  repetitions: number,
): PlannedReading[] {
  const readings: PlannedReading[] = [];
  for (const { prepared, route, skip } of planned) {
    if (skip !== null || route === null) continue;
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      const roles: Array<[ReaderSpec, ReaderRole]> = route.readers.map((reader) => [
        reader,
        'primary',
      ]);
      if (route.policy.tiebreakReader) roles.push([route.policy.tiebreakReader, 'tiebreak']);
      for (const [reader, role] of roles) {
        const { keyInput } = keyInputFor(prepared, reader, repetition);
        readings.push({
          sampleId: prepared.sample.id,
          repetition,
          reader,
          role,
          cacheKey: readingCacheKey(keyInput),
        });
      }
    }
  }
  return readings;
}

class SpendGate {
  private spent = 0;
  private reserved = 0;
  private calls = 0;
  private exhausted = false;
  private readonly observed = new Map<string, number[]>();

  constructor(private readonly budget: SimulationBudget | null) {}

  get spentUsd(): number {
    return this.spent;
  }

  get apiCalls(): number {
    return this.calls;
  }

  get stopped(): boolean {
    return this.exhausted;
  }

  reserve(reader: ReaderSpec): number | null {
    if (this.budget === null) return 0;
    const estimate = this.budget.estimateCallUsd(reader, this.observed.get(reader.model) ?? []);
    if (this.spent + this.reserved + estimate > this.budget.limitUsd) {
      this.exhausted = true;
      return null;
    }
    this.reserved += estimate;
    return estimate;
  }

  settle(reader: ReaderSpec, estimate: number, costUsd: number | null): void {
    this.reserved -= estimate;
    this.calls += 1;
    this.spent += costUsd ?? 0;
    if (costUsd !== null) {
      const list = this.observed.get(reader.model) ?? [];
      list.push(costUsd);
      this.observed.set(reader.model, list);
    }
  }
}

function failedResult(reader: ReaderSpec, errorCode: string): TranscriptionResult {
  return {
    status: 'error',
    output: null,
    rawText: null,
    providerModel: reader.model,
    usage: null,
    costUsd: null,
    latencyMs: 0,
    errorCode,
  };
}

class UnitRunner {
  constructor(
    private readonly options: SimulationOptions,
    private readonly gate: SpendGate,
  ) {}

  async read(
    prepared: PreparedSample,
    reader: ReaderSpec,
    role: ReaderRole,
    repetition: number,
  ): Promise<ReaderRun> {
    const image = prepared.image;
    const { keyInput, rendered } = keyInputFor(prepared, reader, repetition);
    const cacheKey = readingCacheKey(keyInput);
    const cached = await this.options.cache.get(cacheKey);
    if (cached) {
      return {
        reader,
        role,
        cacheKey,
        fromCache: true,
        cacheSource: cached.source,
        result: cached.result,
      };
    }
    const transcriber = this.options.transcriberFor(reader);
    if (transcriber === null || image === null) {
      return this.uncached(reader, role, cacheKey, failedResult(reader, 'no_transcriber'));
    }
    const estimate = this.gate.reserve(reader);
    if (estimate === null) {
      return this.uncached(reader, role, cacheKey, failedResult(reader, 'budget_exceeded'));
    }
    const request: HarnessTranscriptionRequest = {
      readingKey: readingKeyFor(prepared.sample, image),
      image,
      reader,
      prompt: rendered.prompt,
      outputSchema: transcriptionZodSchema(prepared.sample.format),
      format: prepared.sample.format,
    };
    let result: TranscriptionResult;
    try {
      result = await transcriber.transcribe(request);
    } catch (error) {
      result = failedResult(reader, error instanceof Error ? error.name || 'error' : 'error');
    }
    this.gate.settle(reader, estimate, result.costUsd);
    await this.options.cache.put(
      cachedReadingEntry(
        cacheKey,
        keyInput,
        rendered.prompt,
        result,
        this.options.cacheSource ?? 'api',
      ),
    );
    return this.uncached(reader, role, cacheKey, result);
  }

  private uncached(
    reader: ReaderSpec,
    role: ReaderRole,
    cacheKey: string,
    result: TranscriptionResult,
  ): ReaderRun {
    return { reader, role, cacheKey, fromCache: false, cacheSource: null, result };
  }
}

function toConsensusReading(run: ReaderRun, index: number): ConsensusReading {
  return {
    readingId: `${run.reader.key}#${run.role}#${index}`,
    family: run.reader.family,
    status: run.result.status,
    output: run.result.status === 'ok' ? run.result.output : null,
    role: run.role,
  };
}

function readingRecord(
  run: ReaderRun,
  prepared: PreparedSample,
  repetition: number,
): ReadingRecord {
  const { result, reader } = run;
  const { sample, truth, group } = prepared;
  const output = result.status === 'ok' ? result.output : null;
  const answer = output ? normalizeTranscription(output, sample.format) : null;
  const exact =
    group !== 'short' || answer === null
      ? null
      : answer.state === truth.state &&
        (truth.state !== 'answered' ||
          (answer.canonical !== null && answer.canonical === truth.canonical));
  return {
    sampleId: sample.id,
    repetition,
    group,
    formatKind: sample.format.kind,
    readerKey: reader.key,
    provider: reader.provider,
    model: reader.model,
    family: reader.family,
    promptRef: reader.promptRef,
    hints: reader.hints,
    role: run.role,
    cacheKey: run.cacheKey,
    fromCache: run.fromCache,
    cacheSource: run.cacheSource,
    status: result.status,
    errorCode: result.errorCode,
    state: output?.state ?? null,
    literal: output?.literal ?? null,
    parts: output?.parts ?? null,
    canonical: answer?.canonical ?? null,
    confidence: output?.confidence ?? null,
    reviewRequested: output?.reviewRequested ?? null,
    exact,
    fidelity:
      group === 'development' && output ? textSimilarity(output.literal, truth.literal) : null,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
  };
}

export function applyReaderMinConfidence(
  result: ConsensusResult,
  runs: ReadonlyArray<Pick<ReaderRun, 'reader' | 'role' | 'result'>>,
  thresholds: ReaderMinConfidence,
  routeMinConfidence: number,
): { result: ConsensusResult; applied: boolean } {
  const below = runs.some((run) => {
    if (run.role !== 'primary' || run.result.status !== 'ok' || run.result.output === null) {
      return false;
    }
    const threshold = thresholds[run.reader.key] ?? routeMinConfidence;
    return run.result.output.confidence < threshold;
  });
  if (!below) return { result, applied: false };
  const reasons: ReviewReason[] = result.reasons.includes('low_confidence')
    ? [...result.reasons]
    : ['low_confidence', ...result.reasons];
  if (!AUTO_OUTCOMES.has(result.outcome)) {
    return { result: { ...result, reasons }, applied: true };
  }
  return {
    result: { ...result, outcome: 'needs_review', reasons, reviewMode: 'reading' },
    applied: true,
  };
}

function isDecisionCorrect(prepared: PreparedSample, result: ConsensusResult): boolean {
  const value = result.value;
  if (value === null) return false;
  const { truth } = prepared;
  if (truth.state === 'blank') return value.state === 'blank';
  if (truth.state !== 'answered') return false;
  return (
    value.state === 'answered' && value.canonical !== null && value.canonical === truth.canonical
  );
}

function errorKind(delta: number | null): AutoAcceptedErrorKind {
  if (delta === null || delta === 0) return 'neutral';
  return delta < 0 ? 'harms' : 'favors';
}

function unitRecord(
  planned: PlannedSample & { route: ResolvedRouteWithFallback },
  repetition: number,
  result: ConsensusResult,
  runs: readonly ReaderRun[],
  readerThresholdApplied: boolean,
  usedTiebreak: boolean,
): UnitRecord {
  const { prepared, route } = planned;
  const autoAccepted = AUTO_OUTCOMES.has(result.outcome);
  const decisionCorrect = isDecisionCorrect(prepared, result);
  const scorable = autoAccepted && prepared.group === 'short' && result.value !== null;
  const acceptedPoints =
    scorable && result.value !== null ? prepared.scorer.points(result.value) : null;
  const pointsDelta =
    acceptedPoints !== null && prepared.expectedPoints !== null
      ? acceptedPoints - prepared.expectedPoints
      : null;
  const primaryLatency = Math.max(
    0,
    ...runs.filter((run) => run.role === 'primary').map((run) => run.result.latencyMs),
  );
  const tiebreakLatency = runs
    .filter((run) => run.role === 'tiebreak')
    .reduce((sum, run) => sum + run.result.latencyMs, 0);
  return {
    sampleId: prepared.sample.id,
    repetition,
    group: prepared.group,
    formatKind: prepared.sample.format.kind,
    routeId: route.routeId,
    routeVersion: route.routeVersion,
    routeLevel: route.matchedLevel,
    outcome: result.outcome,
    autoAccepted,
    reasons: result.reasons,
    reviewMode: result.reviewMode,
    readerThresholdApplied,
    canonical: result.value?.canonical ?? null,
    valueState: result.value?.state ?? null,
    decisionCorrect,
    scoringOutcome: result.scoringOutcome,
    acceptedPoints,
    expectedPoints: prepared.expectedPoints,
    pointsDelta,
    autoAcceptedError:
      autoAccepted && prepared.group === 'short' && !decisionCorrect
        ? errorKind(pointsDelta)
        : null,
    usedTiebreak,
    costUsd: runs.reduce((sum, run) => sum + (run.result.costUsd ?? 0), 0),
    latencyMs: primaryLatency + tiebreakLatency,
  };
}

async function runUnit(
  runner: UnitRunner,
  planned: PlannedSample & { route: ResolvedRouteWithFallback },
  repetition: number,
  thresholds: ReaderMinConfidence | null,
): Promise<{ unit: UnitRecord; readings: ReadingRecord[] }> {
  const { prepared, route } = planned;
  const basePolicy: ConsensusPolicy = { ...route.policy, auditSampleRate: 0 };
  const policy: ConsensusPolicy = thresholds ? { ...basePolicy, minConfidence: 0 } : basePolicy;
  const options = {
    format: prepared.sample.format,
    readingKey: `${prepared.sample.id}#${repetition}`,
  };
  const runs = await Promise.all(
    route.readers.map((reader) => runner.read(prepared, reader, 'primary', repetition)),
  );
  let readings = runs.map(toConsensusReading);
  let result = evaluateConsensus(readings, policy, prepared.scorer.outcome, options);
  let usedTiebreak = false;
  if (policy.tiebreakReader !== null && needsTiebreak(result, readings, policy)) {
    runs.push(await runner.read(prepared, policy.tiebreakReader, 'tiebreak', repetition));
    readings = runs.map(toConsensusReading);
    result = evaluateConsensus(readings, policy, prepared.scorer.outcome, options);
    usedTiebreak = true;
  }
  const adjusted = thresholds
    ? applyReaderMinConfidence(result, runs, thresholds, route.policy.minConfidence)
    : { result, applied: false };
  return {
    unit: unitRecord(planned, repetition, adjusted.result, runs, adjusted.applied, usedTiebreak),
    readings: runs.map((run) => readingRecord(run, prepared, repetition)),
  };
}

function sampleRecord(planned: PlannedSample): SampleRecord {
  const { prepared, route, skip } = planned;
  const { sample, truth } = prepared;
  return {
    id: sample.id,
    image: sample.image,
    student: sample.student ?? null,
    question: sample.question ?? null,
    formatKind: sample.format.kind,
    group: prepared.group,
    truth: { state: truth.state, literal: truth.literal, canonical: truth.canonical },
    expectedOutcome: prepared.expectedOutcome,
    expectedPoints: prepared.expectedPoints,
    maxPoints: prepared.maxPoints,
    scoringFormatKind: prepared.scoringFormat?.kind ?? null,
    routeId: route?.routeId ?? null,
    skipped: skip?.reason ?? null,
    skipDetail: skip?.detail ?? null,
  };
}

export async function runSimulation(options: SimulationOptions): Promise<SimulationResult> {
  const planned = planSamples(options.samples, options.routeSet);
  const gate = new SpendGate(options.budget);
  const runner = new UnitRunner(options, gate);
  const work: Array<{
    planned: PlannedSample & { route: ResolvedRouteWithFallback };
    rep: number;
  }> = [];
  for (const entry of planned) {
    if (entry.skip !== null || entry.route === null) continue;
    const route = entry.route;
    for (let rep = 0; rep < options.repetitions; rep += 1) {
      work.push({ planned: { ...entry, route }, rep });
    }
  }
  const units: UnitRecord[] = [];
  const readings: ReadingRecord[] = [];
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < work.length) {
      const job = work[next];
      next += 1;
      if (!job) return;
      const outcome = await runUnit(runner, job.planned, job.rep, options.readerMinConfidence);
      units.push(outcome.unit);
      readings.push(...outcome.readings);
      done += 1;
      options.onUnitDone?.({ done, total: work.length, spentUsd: gate.spentUsd });
    }
  };
  const workers = Math.max(1, Math.min(options.concurrency, work.length || 1));
  await Promise.all(Array.from({ length: workers }, worker));
  const order = new Map(planned.map((entry, index) => [entry.prepared.sample.id, index]));
  const byPosition = (a: { sampleId: string; repetition: number }, b: typeof a) =>
    (order.get(a.sampleId) ?? 0) - (order.get(b.sampleId) ?? 0) || a.repetition - b.repetition;
  units.sort(byPosition);
  readings.sort(byPosition);
  return {
    samples: planned.map(sampleRecord),
    units,
    readings,
    spentUsd: gate.spentUsd,
    apiCalls: gate.apiCalls,
    stoppedByBudget: gate.stopped,
  };
}
