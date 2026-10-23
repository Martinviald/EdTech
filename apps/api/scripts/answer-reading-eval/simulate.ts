import {
  acceptedAnswersOf,
  agreedConsensusReadings,
  agreedReadingOf,
  agreedValue,
  applyDecisionTiebreak,
  finalizeInterpretedConsensus,
  isInterpretationPromptFor,
  planInterpretedConsensus,
  renderInterpretationPrompt,
  toInterpretedReading,
  type DecideAcceptance,
  type InterpretationResult,
  type InterpretationRequest,
  type InterpretedReaderResult,
  type TiebreakCandidate,
  type TiebreakChoice,
  type VerifiedAnswer,
  type VerifyAnswer,
  applyIncorrectVerification,
  applyReadingAudit,
  evaluateConsensus,
  fakeOutput,
  isTranscriptionPromptFor,
  isReadingAuditPromptFor,
  isVerificationPromptFor,
  itemStemOf,
  needsIncorrectVerification,
  needsReadingAudit,
  needsTiebreak,
  normalizeTranscription,
  readingAuditApproves,
  readingAuditCandidate,
  readingKeyFor,
  renderReadingAuditPrompt,
  renderTranscriptionPrompt,
  responseGeometryOf,
  renderVerificationPrompt,
  type ConsensusReading,
  type ReadingAuditCandidate,
  type ReadingAuditRequest,
  type ReadingAuditResult,
  type ResolvedRouteWithFallback,
  type StructuredVisionResult,
  type TranscriptionRequest,
  type TranscriptionResult,
  type VerificationRequest,
  type VerificationResult,
} from '@soe/answer-reading';
import type {
  AnswerSpace,
  ConsensusPolicy,
  ConsensusResult,
  InterpretedReading,
  ItemType,
  ReaderSpec,
  ReadingAuditOutput,
  ReadingAuditor,
  ReadingOutcome,
  ReadingState,
  ResponseFormat,
  ResponseFormatKind,
  ReviewMode,
  ReviewReason,
  ScoringOutcome,
  TranscriptionStatus,
  VerificationOutput,
} from '@soe/types';
import {
  buildAnswerReadingTiebreakDecision,
  tiebreakChoiceOf,
} from '../../src/answer-reading/answer-reading-tiebreak-decision';
import type { PreparedSample, SampleGroup } from './dataset';
import { DecisionCache, decisionCacheKey, type HarnessDecider } from './decision-cache';
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
  verify?(request: VerificationRequest): Promise<VerificationResult>;
  audit?(request: ReadingAuditRequest): Promise<ReadingAuditResult>;
  interpret?(request: InterpretationRequest): Promise<InterpretationResult>;
}

export interface InterpretationSimulation {
  readonly verify: VerifyAnswer;
  readonly decideAcceptance: DecideAcceptance;
  readonly decisionCache: DecisionCache;
  readonly decider: HarnessDecider | null;
  readonly decisionEngine: string;
  readonly decisionModel: string;
}

export interface DecisionRecord {
  readonly called: boolean;
  readonly fromCache: boolean;
  readonly missing: boolean;
  readonly choice: TiebreakChoice | null;
  readonly accepted: boolean;
  readonly costUsd: number;
  readonly latencyMs: number;
}

export interface InterpretationUnitRecord {
  readonly verified: readonly (VerifiedAnswer['status'] | null)[];
  readonly agreementVia: 'consensus' | 'tiebreak' | null;
  readonly agreementStrength: string | null;
  readonly crossSupport: string | null;
  readonly acceptance: string;
  readonly decision: DecisionRecord | null;
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

export interface VerifierRecord {
  readonly readerKey: string;
  readonly model: string;
  readonly called: boolean;
  readonly fromCache: boolean;
  readonly status: TranscriptionStatus | null;
  readonly errorCode: string | null;
  readonly couldBeKey: boolean | null;
  readonly confidence: number | null;
  readonly differingCharacters: readonly string[];
  readonly flagged: boolean;
  readonly costUsd: number;
  readonly latencyMs: number;
}

export interface AuditorRecord {
  readonly readerKey: string;
  readonly model: string;
  readonly candidate: string | null;
  readonly called: boolean;
  readonly fromCache: boolean;
  readonly status: TranscriptionStatus | null;
  readonly errorCode: string | null;
  readonly verdict: ReadingAuditOutput['verdict'] | null;
  readonly confidence: number | null;
  readonly suspiciousCharacters: readonly string[];
  readonly approved: boolean;
  readonly accepted: boolean;
  readonly costUsd: number;
  readonly latencyMs: number;
}

export interface BeforeVerifierRecord {
  readonly outcome: ReadingOutcome;
  readonly autoAcceptedError: AutoAcceptedErrorKind | null;
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
  readonly injected: boolean;
  readonly auditor: AuditorRecord | null;
  readonly verifier: VerifierRecord | null;
  readonly beforeVerifier: BeforeVerifierRecord | null;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly interpretation?: InterpretationUnitRecord;
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
  readonly injectedEscalation?: boolean;
  readonly interpretation?: InterpretationSimulation | null;
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

type InterpretedOutputOf<T> = T extends StructuredVisionResult<infer O> ? O : never;

interface InterpretationRun {
  readonly reader: ReaderSpec;
  readonly cacheKey: string;
  readonly fromCache: boolean;
  readonly cacheSource: string | null;
  readonly result: InterpretationResult;
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
  if (route.policy.readMode === 'interpreted') {
    const notInterpreting = route.readers.find(
      (reader) => !isInterpretationPromptFor(reader.promptRef, sample.format.kind),
    );
    return notInterpreting
      ? {
          reason: 'prompt_unsupported_format',
          detail: `El prompt ${notInterpreting.promptRef} no interpreta el formato ${sample.format.kind}`,
        }
      : null;
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
  const { sample } = prepared;
  const rendered = renderTranscriptionPrompt(reader, sample.format, {
    gradeName: sample.gradeName ?? null,
    geometry: responseGeometryOf(
      sample.item?.content ?? { acceptedAnswers: sample.acceptedAnswers },
    ),
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

function interpretationKeyInputFor(
  prepared: PreparedSample,
  reader: ReaderSpec,
  repetition: number,
): {
  keyInput: ReadingCacheKeyInput;
  rendered: ReturnType<typeof renderInterpretationPrompt>;
} {
  const { sample } = prepared;
  const rendered = renderInterpretationPrompt(reader, sample.format, {
    gradeName: sample.gradeName ?? null,
    space: sample.answerSpace ?? null,
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
    if (skip !== null || route === null || prepared.sample.injectedReading) continue;
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      const roles: Array<[ReaderSpec, ReaderRole]> = route.readers.map((reader) => [
        reader,
        'primary',
      ]);
      if (route.policy.tiebreakReader) roles.push([route.policy.tiebreakReader, 'tiebreak']);
      const interpreted = route.policy.readMode === 'interpreted';
      for (const [reader, role] of roles) {
        const { keyInput } = interpreted
          ? interpretationKeyInputFor(prepared, reader, repetition)
          : keyInputFor(prepared, reader, repetition);
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

function failedResult<TOutput>(
  reader: ReaderSpec,
  errorCode: string,
): StructuredVisionResult<TOutput> {
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
      outputSchema: rendered.outputZodSchema,
      outputJsonSchema: rendered.outputSchema,
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

  async interpret(
    prepared: PreparedSample,
    reader: ReaderSpec,
    repetition: number,
  ): Promise<InterpretationRun> {
    const image = prepared.image;
    const { keyInput, rendered } = interpretationKeyInputFor(prepared, reader, repetition);
    const cacheKey = readingCacheKey(keyInput);
    const cached =
      await this.options.cache.get<InterpretedOutputOf<InterpretationResult>>(cacheKey);
    if (cached) {
      return {
        reader,
        cacheKey,
        fromCache: true,
        cacheSource: cached.source,
        result: cached.result,
      };
    }
    const transcriber = this.options.transcriberFor(reader);
    if (transcriber?.interpret === undefined || image === null) {
      return {
        reader,
        cacheKey,
        fromCache: false,
        cacheSource: null,
        result: failedResult(reader, 'no_transcriber'),
      };
    }
    const estimate = this.gate.reserve(reader);
    if (estimate === null) {
      return {
        reader,
        cacheKey,
        fromCache: false,
        cacheSource: null,
        result: failedResult(reader, 'budget_exceeded'),
      };
    }
    let result: InterpretationResult;
    try {
      result = await transcriber.interpret({
        readingKey: readingKeyFor(prepared.sample, image),
        image,
        reader,
        prompt: rendered.prompt,
        outputSchema: rendered.outputSchema,
        outputZodSchema: rendered.outputZodSchema,
      });
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
    return { reader, cacheKey, fromCache: false, cacheSource: null, result };
  }

  async decide(
    prepared: PreparedSample,
    candidates: readonly TiebreakCandidate[],
    space: AnswerSpace,
    simulation: InterpretationSimulation,
  ): Promise<DecisionRecord> {
    const image = prepared.image;
    const decision = buildAnswerReadingTiebreakDecision(candidates, {
      gradeName: prepared.sample.gradeName ?? null,
      format: prepared.sample.format,
      space,
    });
    const imageSha256 = image?.sha256 ?? '';
    const key = decisionCacheKey({
      engine: simulation.decisionEngine,
      model: simulation.decisionModel,
      state: decision.state,
      questions: decision.questions,
      imageSha256,
    });
    const cached = await simulation.decisionCache.get(key);
    if (cached?.answer) {
      return {
        called: false,
        fromCache: true,
        missing: false,
        choice: tiebreakChoiceOf(decision, cached.answer),
        accepted: false,
        costUsd: 0,
        latencyMs: cached.latencyMs,
      };
    }
    if (simulation.decider === null || image === null) {
      return {
        called: false,
        fromCache: false,
        missing: true,
        choice: null,
        accepted: false,
        costUsd: 0,
        latencyMs: 0,
      };
    }
    const outcome = await simulation.decider.decide({
      state: decision.state,
      questions: decision.questions,
      image: { mimeType: image.mimeType, base64: image.base64 },
    });
    await simulation.decisionCache.put({
      key,
      storedAt: new Date().toISOString(),
      engine: simulation.decisionEngine,
      model: outcome.model,
      status: outcome.answer ? 'ok' : 'error',
      ...(outcome.answer ? { answer: outcome.answer } : {}),
      ...(outcome.usage ? { usage: outcome.usage } : {}),
      costUsd: outcome.costUsd,
      latencyMs: outcome.latencyMs,
      imageSha256,
      ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
    });
    return {
      called: true,
      fromCache: false,
      missing: outcome.answer === null,
      choice: outcome.answer ? tiebreakChoiceOf(decision, outcome.answer) : null,
      accepted: false,
      costUsd: outcome.costUsd,
      latencyMs: outcome.latencyMs,
    };
  }

  async verify(
    prepared: PreparedSample,
    verifier: ReaderSpec,
    result: ConsensusResult,
    readings: readonly ConsensusReading[],
    repetition: number,
  ): Promise<VerifierRun | null> {
    const image = prepared.image;
    const agreedReading = agreedReadingOf(result, readings);
    const acceptedAnswers = prepared.sample.item
      ? acceptedAnswersOf({
          type: prepared.sample.item.type as ItemType,
          content: prepared.sample.item.content,
        })
      : [...(prepared.sample.acceptedAnswers ?? [])];
    if (
      image === null ||
      agreedReading === null ||
      acceptedAnswers.length === 0 ||
      !isVerificationPromptFor(verifier.promptRef, prepared.sample.format)
    ) {
      return null;
    }
    const rendered = renderVerificationPrompt({
      reader: verifier,
      format: prepared.sample.format,
      agreedReading,
      acceptedAnswers,
      gradeName: prepared.sample.gradeName ?? null,
    });
    const keyInput = {
      reader: verifier,
      prompt: rendered.prompt,
      outputJsonSchema: rendered.outputSchema,
      imageSha256: image.sha256,
      repetition,
    };
    const cacheKey = readingCacheKey(keyInput);
    const cached = await this.options.cache.get<VerificationOutput>(cacheKey);
    if (cached) return { fromCache: true, result: cached.result };
    const transcriber = this.options.transcriberFor(verifier);
    if (!transcriber?.verify) {
      return { fromCache: false, result: failedResult(verifier, 'no_transcriber') };
    }
    const estimate = this.gate.reserve(verifier);
    if (estimate === null) {
      return { fromCache: false, result: failedResult(verifier, 'budget_exceeded') };
    }
    let verification: VerificationResult;
    try {
      verification = await transcriber.verify({
        readingKey: cacheKey,
        image,
        reader: verifier,
        prompt: rendered.prompt,
        outputSchema: rendered.outputSchema,
      });
    } catch (error) {
      verification = failedResult(
        verifier,
        error instanceof Error ? error.name || 'error' : 'error',
      );
    }
    this.gate.settle(verifier, estimate, verification.costUsd);
    await this.options.cache.put(
      cachedReadingEntry(
        cacheKey,
        keyInput,
        rendered.prompt,
        verification,
        this.options.cacheSource ?? 'api',
      ),
    );
    return { fromCache: false, result: verification };
  }

  async audit(
    prepared: PreparedSample,
    auditor: ReadingAuditor,
    candidate: ReadingAuditCandidate,
    repetition: number,
  ): Promise<AuditorRun | null> {
    const image = prepared.image;
    const reader = auditor.reader;
    if (image === null || !isReadingAuditPromptFor(reader.promptRef, prepared.sample.format)) {
      return null;
    }
    const rendered = renderReadingAuditPrompt({
      reader,
      format: prepared.sample.format,
      candidate,
      stem: itemStemOf(prepared.sample.item?.content),
      gradeName: prepared.sample.gradeName ?? null,
    });
    const keyInput = {
      reader,
      prompt: rendered.prompt,
      outputJsonSchema: rendered.outputSchema,
      imageSha256: image.sha256,
      repetition,
    };
    const cacheKey = readingCacheKey(keyInput);
    const cached = await this.options.cache.get<ReadingAuditOutput>(cacheKey);
    if (cached) return { fromCache: true, result: cached.result };
    const transcriber = this.options.transcriberFor(reader);
    if (!transcriber?.audit) {
      return { fromCache: false, result: failedResult(reader, 'no_transcriber') };
    }
    const estimate = this.gate.reserve(reader);
    if (estimate === null) {
      return { fromCache: false, result: failedResult(reader, 'budget_exceeded') };
    }
    let audit: ReadingAuditResult;
    try {
      audit = await transcriber.audit({
        readingKey: cacheKey,
        image,
        reader,
        prompt: rendered.prompt,
        outputSchema: rendered.outputSchema,
      });
    } catch (error) {
      audit = failedResult(reader, error instanceof Error ? error.name || 'error' : 'error');
    }
    this.gate.settle(reader, estimate, audit.costUsd);
    await this.options.cache.put(
      cachedReadingEntry(
        cacheKey,
        keyInput,
        rendered.prompt,
        audit,
        this.options.cacheSource ?? 'api',
      ),
    );
    return { fromCache: false, result: audit };
  }
}

interface VerifierRun {
  readonly fromCache: boolean;
  readonly result: VerificationResult;
}

interface AuditorRun {
  readonly fromCache: boolean;
  readonly result: ReadingAuditResult;
}

function toConsensusReading(run: ReaderRun, index: number): ConsensusReading {
  return {
    readingId: `${run.reader.key}#${run.role}#${index}`,
    family: run.reader.family,
    provider: run.reader.provider,
    status: run.result.status,
    output: run.result.status === 'ok' ? run.result.output : null,
    role: run.role,
    ...(run.reader.minConfidence === undefined ? {} : { minConfidence: run.reader.minConfidence }),
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

interface UnitExtras {
  readonly injected: boolean;
  readonly auditor: AuditorRecord | null;
  readonly verifier: VerifierRecord | null;
  readonly beforeVerifier: ConsensusResult | null;
}

function scoredOutcome(
  prepared: PreparedSample,
  result: ConsensusResult,
): {
  autoAccepted: boolean;
  decisionCorrect: boolean;
  acceptedPoints: number | null;
  pointsDelta: number | null;
  autoAcceptedError: AutoAcceptedErrorKind | null;
} {
  const autoAccepted = AUTO_OUTCOMES.has(result.outcome);
  const decisionCorrect = isDecisionCorrect(prepared, result);
  const scorable = autoAccepted && prepared.group === 'short' && result.value !== null;
  const acceptedPoints =
    scorable && result.value !== null ? prepared.scorer.points(result.value) : null;
  const pointsDelta =
    acceptedPoints !== null && prepared.expectedPoints !== null
      ? acceptedPoints - prepared.expectedPoints
      : null;
  return {
    autoAccepted,
    decisionCorrect,
    acceptedPoints,
    pointsDelta,
    autoAcceptedError:
      autoAccepted && prepared.group === 'short' && !decisionCorrect
        ? errorKind(pointsDelta)
        : null,
  };
}

interface CostedRun {
  readonly role: ReaderRole;
  readonly result: { readonly latencyMs: number; readonly costUsd: number | null };
}

function unitRecord(
  planned: PlannedSample & { route: ResolvedRouteWithFallback },
  repetition: number,
  result: ConsensusResult,
  runs: readonly CostedRun[],
  readerThresholdApplied: boolean,
  usedTiebreak: boolean,
  extras: UnitExtras,
): UnitRecord {
  const { prepared, route } = planned;
  const scored = scoredOutcome(prepared, result);
  const primaryLatency = Math.max(
    0,
    ...runs.filter((run) => run.role === 'primary').map((run) => run.result.latencyMs),
  );
  const tiebreakLatency = runs
    .filter((run) => run.role === 'tiebreak')
    .reduce((sum, run) => sum + run.result.latencyMs, 0);
  const verifierCost = (extras.verifier?.costUsd ?? 0) + (extras.auditor?.costUsd ?? 0);
  return {
    sampleId: prepared.sample.id,
    repetition,
    group: prepared.group,
    formatKind: prepared.sample.format.kind,
    routeId: route.routeId,
    routeVersion: route.routeVersion,
    routeLevel: route.matchedLevel,
    outcome: result.outcome,
    autoAccepted: scored.autoAccepted,
    reasons: result.reasons,
    reviewMode: result.reviewMode,
    readerThresholdApplied,
    canonical: result.value?.canonical ?? null,
    valueState: result.value?.state ?? null,
    decisionCorrect: scored.decisionCorrect,
    scoringOutcome: result.scoringOutcome,
    acceptedPoints: scored.acceptedPoints,
    expectedPoints: prepared.expectedPoints,
    pointsDelta: scored.pointsDelta,
    autoAcceptedError: scored.autoAcceptedError,
    usedTiebreak,
    injected: extras.injected,
    auditor: extras.auditor,
    verifier: extras.verifier,
    beforeVerifier: extras.beforeVerifier
      ? {
          outcome: extras.beforeVerifier.outcome,
          autoAcceptedError: scoredOutcome(prepared, extras.beforeVerifier).autoAcceptedError,
        }
      : null,
    costUsd: runs.reduce((sum, run) => sum + (run.result.costUsd ?? 0), 0) + verifierCost,
    latencyMs:
      primaryLatency +
      tiebreakLatency +
      (extras.auditor?.latencyMs ?? 0) +
      (extras.verifier?.latencyMs ?? 0),
  };
}

function injectedReadings(
  prepared: PreparedSample,
  route: ResolvedRouteWithFallback,
  escalation: boolean,
): ConsensusReading[] {
  const injected = prepared.sample.injectedReading;
  if (!injected) return [];
  if (escalation) {
    const doubtful = fakeOutput(injected.literal, { parts: injected.parts ?? null, confidence: 0 });
    return route.readers.map((reader) => ({
      readingId: `injected#${reader.key}`,
      family: reader.family,
      provider: reader.provider,
      status: 'ok' as const,
      output: doubtful,
      role: 'primary' as const,
      ...(reader.minConfidence === undefined ? {} : { minConfidence: reader.minConfidence }),
    }));
  }
  const output = fakeOutput(injected.literal, { parts: injected.parts ?? null });
  return ['a', 'b'].map((suffix) => ({
    readingId: `injected#${suffix}`,
    family: `injected-${suffix}`,
    status: 'ok' as const,
    output,
    role: 'primary' as const,
  }));
}

async function auditUnit(
  runner: UnitRunner,
  prepared: PreparedSample,
  policy: ConsensusPolicy,
  result: ConsensusResult,
  readings: readonly ConsensusReading[],
  repetition: number,
): Promise<{ result: ConsensusResult; record: AuditorRecord | null }> {
  const auditor = policy.readingAuditor;
  const format = prepared.sample.format;
  if (!auditor || !needsReadingAudit(result, policy, format)) return { result, record: null };
  const candidate = readingAuditCandidate(readings, format);
  const run = candidate ? await runner.audit(prepared, auditor, candidate, repetition) : null;
  const output = run?.result.status === 'ok' ? run.result.output : null;
  const verdict = run ? { status: run.result.status, output } : null;
  const audited = applyReadingAudit(result, policy, candidate, verdict, prepared.scorer.outcome, {
    format,
    readingKey: `${prepared.sample.id}#${repetition}`,
  });
  return {
    result: audited,
    record: {
      readerKey: auditor.reader.key,
      model: auditor.reader.model,
      candidate: candidate?.answer.canonical ?? null,
      called: run !== null && !run.fromCache && run.result.errorCode !== 'no_transcriber',
      fromCache: run?.fromCache ?? false,
      status: run?.result.status ?? null,
      errorCode: run?.result.errorCode ?? null,
      verdict: output?.verdict ?? null,
      confidence: output?.confidence ?? null,
      suspiciousCharacters: output?.suspiciousCharacters ?? [],
      approved: verdict !== null && readingAuditApproves(verdict, auditor.minConfidence),
      accepted: audited !== result,
      costUsd: run?.result.costUsd ?? 0,
      latencyMs: run?.result.latencyMs ?? 0,
    },
  };
}

async function verifyUnit(
  runner: UnitRunner,
  prepared: PreparedSample,
  policy: ConsensusPolicy,
  result: ConsensusResult,
  readings: readonly ConsensusReading[],
  repetition: number,
): Promise<{ result: ConsensusResult; record: VerifierRecord | null }> {
  const verifier = policy.incorrectVerifier;
  if (!verifier || !needsIncorrectVerification(result, policy)) return { result, record: null };
  const run = await runner.verify(prepared, verifier, result, readings, repetition);
  const output = run?.result.status === 'ok' ? run.result.output : null;
  const verified = applyIncorrectVerification(
    result,
    policy,
    run ? { status: run.result.status, output } : null,
  );
  return {
    result: verified,
    record: {
      readerKey: verifier.key,
      model: verifier.model,
      called: run !== null && !run.fromCache && run.result.errorCode !== 'no_transcriber',
      fromCache: run?.fromCache ?? false,
      status: run?.result.status ?? null,
      errorCode: run?.result.errorCode ?? null,
      couldBeKey: output?.couldBeKey ?? null,
      confidence: output?.confidence ?? null,
      differingCharacters: output?.differingCharacters ?? [],
      flagged: verified.outcome !== result.outcome,
      costUsd: run?.result.costUsd ?? 0,
      latencyMs: run?.result.latencyMs ?? 0,
    },
  };
}

function withReaderThreshold(reader: ReaderSpec, thresholds: ReaderMinConfidence): ReaderSpec {
  const threshold = thresholds[reader.key];
  return threshold === undefined ? reader : { ...reader, minConfidence: threshold };
}

function withReaderThresholds(
  route: ResolvedRouteWithFallback,
  thresholds: ReaderMinConfidence | null,
): ResolvedRouteWithFallback {
  if (!thresholds) return route;
  const tiebreakReader = route.policy.tiebreakReader;
  return {
    ...route,
    readers: route.readers.map((reader) => withReaderThreshold(reader, thresholds)),
    policy: {
      ...route.policy,
      tiebreakReader:
        tiebreakReader === null ? null : withReaderThreshold(tiebreakReader, thresholds),
    },
  };
}

const INTERPRETED_READING_STATES: Readonly<Record<InterpretedReading['state'], ReadingState>> = {
  answered: 'answered',
  ambiguous: 'multiple_answers',
  blank: 'blank',
  illegible: 'illegible',
};

function interpretedReadingRecord(
  run: InterpretationRun,
  prepared: PreparedSample,
  repetition: number,
): ReadingRecord {
  const { result, reader } = run;
  const { sample, truth, group } = prepared;
  const reading =
    result.status === 'ok' && result.output ? toInterpretedReading(result.output) : null;
  const answer =
    reading === null
      ? null
      : agreedValue(
          reading.state === 'blank'
            ? { kind: 'blank', blankEvidence: 'unverified' }
            : {
                kind: 'answer',
                canonical: reading.answer,
                answerText: reading.answer,
                via: 'consensus',
                strength: 'direct',
                crossSupport: 'no_other',
              },
          sample.format,
        );
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
    role: 'primary',
    cacheKey: run.cacheKey,
    fromCache: run.fromCache,
    cacheSource: run.cacheSource,
    status: result.status,
    errorCode: result.errorCode,
    state: reading ? INTERPRETED_READING_STATES[reading.state] : null,
    literal: reading?.answer ?? null,
    parts: null,
    canonical: answer?.canonical ?? null,
    confidence: reading?.confidence ?? null,
    reviewRequested: null,
    exact,
    fidelity: null,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
  };
}

async function runInterpretedUnit(
  runner: UnitRunner,
  planned: PlannedSample & { route: ResolvedRouteWithFallback },
  repetition: number,
  thresholds: ReaderMinConfidence | null,
  simulation: InterpretationSimulation,
): Promise<{ unit: UnitRecord; readings: ReadingRecord[] }> {
  const { prepared } = planned;
  const { sample } = prepared;
  const route = withReaderThresholds(planned.route, thresholds);
  const policy: ConsensusPolicy = { ...route.policy, auditSampleRate: 0 };
  const space: AnswerSpace = sample.answerSpace ?? { kind: 'open' };
  const runs = await Promise.all(
    route.readers.map((reader) => runner.interpret(prepared, reader, repetition)),
  );
  const readers: InterpretedReaderResult[] = runs.map((run, index) => ({
    readingId: `${run.reader.key}#primary#${index}`,
    provider: run.reader.provider,
    family: run.reader.family,
    minConfidence: run.reader.minConfidence ?? policy.minConfidence,
    reading:
      run.result.status === 'ok' && run.result.output
        ? toInterpretedReading(run.result.output)
        : null,
  }));
  const plan = planInterpretedConsensus({
    readers,
    verify: simulation.verify,
    format: sample.format,
    space,
  });
  let agreement = plan.agreement;
  let decision: DecisionRecord | null = null;
  if (agreement === null && policy.decisionTiebreak && plan.tiebreakCandidates.length > 0) {
    decision = await runner.decide(prepared, plan.tiebreakCandidates, space, simulation);
    agreement = applyDecisionTiebreak(plan, decision.choice, policy.decisionTiebreak);
    decision = { ...decision, accepted: agreement !== null };
  }
  const value = agreement ? agreedValue(agreement, sample.format) : null;
  const scoring = agreement?.kind === 'answer' && value ? prepared.scorer.outcome(value) : null;
  const acceptance = simulation.decideAcceptance({
    verified: plan.verified.flatMap((entry) => (entry ? [entry] : [])),
    agreement,
    scoring,
    readings: readers.flatMap((reader) => (reader.reading ? [reader.reading] : [])),
  });
  const consensus = finalizeInterpretedConsensus({
    plan,
    agreement,
    value,
    scoring,
    decision: acceptance,
    policy,
    readingKey: `${sample.id}#${repetition}`,
  });
  const verified =
    acceptance.action === 'verify_incorrect' && agreement !== null
      ? await verifyUnit(
          runner,
          prepared,
          policy,
          consensus,
          agreedConsensusReadings(plan, agreement),
          repetition,
        )
      : { result: consensus, record: null };
  const unit = unitRecord(
    planned,
    repetition,
    verified.result,
    runs.map((run) => ({ role: 'primary' as const, result: run.result })),
    false,
    decision?.accepted ?? false,
    {
      injected: false,
      auditor: null,
      verifier: verified.record,
      beforeVerifier: verified.record ? consensus : null,
    },
  );
  return {
    unit: {
      ...unit,
      costUsd: unit.costUsd + (decision?.costUsd ?? 0),
      latencyMs: unit.latencyMs + (decision?.latencyMs ?? 0),
      interpretation: {
        verified: plan.verified.map((entry) => entry?.status ?? null),
        agreementVia: agreement?.kind === 'answer' ? agreement.via : agreement ? 'consensus' : null,
        agreementStrength: agreement?.kind === 'answer' ? agreement.strength : null,
        crossSupport: agreement?.kind === 'answer' ? agreement.crossSupport : null,
        acceptance: acceptance.action,
        decision,
      },
    },
    readings: runs.map((run) => interpretedReadingRecord(run, prepared, repetition)),
  };
}

async function runUnit(
  runner: UnitRunner,
  planned: PlannedSample & { route: ResolvedRouteWithFallback },
  repetition: number,
  thresholds: ReaderMinConfidence | null,
  injectedEscalation: boolean,
  interpretation: InterpretationSimulation | null,
): Promise<{ unit: UnitRecord; readings: ReadingRecord[] }> {
  if (planned.route.policy.readMode === 'interpreted') {
    if (!interpretation) {
      throw new Error(
        'La ruta es de lectura interpretada: falta configurar verifyAnswer y la política',
      );
    }
    return runInterpretedUnit(runner, planned, repetition, thresholds, interpretation);
  }
  const { prepared } = planned;
  const route = withReaderThresholds(planned.route, thresholds);
  const basePolicy: ConsensusPolicy = { ...route.policy, auditSampleRate: 0 };
  const policy: ConsensusPolicy = thresholds ? { ...basePolicy, minConfidence: 0 } : basePolicy;
  const options = {
    format: prepared.sample.format,
    readingKey: `${prepared.sample.id}#${repetition}`,
  };
  const injected = prepared.sample.injectedReading !== undefined;
  const runs = injected
    ? []
    : await Promise.all(
        route.readers.map((reader) => runner.read(prepared, reader, 'primary', repetition)),
      );
  const escalateInjected = injected && injectedEscalation && policy.tiebreakOn !== undefined;
  let readings = injected
    ? injectedReadings(prepared, route, escalateInjected)
    : runs.map(toConsensusReading);
  let result = evaluateConsensus(readings, policy, prepared.scorer.outcome, options);
  let usedTiebreak = false;
  if (
    (!injected || escalateInjected) &&
    policy.tiebreakReader !== null &&
    needsTiebreak(result, readings, policy)
  ) {
    const tiebreakRun = await runner.read(prepared, policy.tiebreakReader, 'tiebreak', repetition);
    runs.push(tiebreakRun);
    readings = [...readings, toConsensusReading(tiebreakRun, runs.length - 1)];
    result = evaluateConsensus(readings, policy, prepared.scorer.outcome, options);
    usedTiebreak = true;
  }
  const adjusted = thresholds
    ? applyReaderMinConfidence(result, runs, thresholds, route.policy.minConfidence)
    : { result, applied: false };
  const audited = await auditUnit(
    runner,
    prepared,
    basePolicy,
    adjusted.result,
    readings,
    repetition,
  );
  const verified = await verifyUnit(
    runner,
    prepared,
    basePolicy,
    audited.result,
    readings,
    repetition,
  );
  return {
    unit: unitRecord(planned, repetition, verified.result, runs, adjusted.applied, usedTiebreak, {
      injected,
      auditor: audited.record,
      verifier: verified.record,
      beforeVerifier: verified.record ? audited.result : null,
    }),
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
      const outcome = await runUnit(
        runner,
        job.planned,
        job.rep,
        options.readerMinConfidence,
        options.injectedEscalation ?? false,
        options.interpretation ?? null,
      );
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
