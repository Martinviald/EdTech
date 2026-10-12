import { createHash } from 'node:crypto';
import type {
  CanonicalValue,
  ConsensusPolicy,
  ConsensusResult,
  NormalizedAnswer,
  ReaderSpec,
  ReadingOutcome,
  ReadingState,
  ResponseFormat,
  ReviewMode,
  ReviewReason,
  ScoringOutcome,
  TranscriptionStatus,
} from '@soe/types';
import {
  evaluateConsensus,
  needsTiebreak,
  type ConsensusReading,
  type ScoreOf,
} from '../consensus/evaluate-consensus';
import { normalizeTranscription } from '../formats/registry';
import {
  transcriptionZodSchema,
  type TranscriptionJsonSchema,
} from '../formats/transcription-json-schema';
import { isTranscriptionPromptFor, renderTranscriptionPrompt } from '../prompts/registry';
import type { TranscriptionImage, TranscriptionRequest, TranscriptionResult } from '../transcriber';
import {
  expectedScoringOutcome,
  isEvaluableFormat,
  labelTruth,
  sampleScorer,
  type LabelTruth,
} from './label';
import type { EvalSample } from './manifest';

/**
 * Request del arnés: el del puerto más el JSON Schema plano del formato, que los
 * adaptadores LLM necesitan para pedir salida estructurada.
 */
export interface EvalTranscriptionRequest extends TranscriptionRequest {
  readonly outputJsonSchema: TranscriptionJsonSchema;
}

export interface EvalTranscriber {
  readonly id: string;
  supports(reader: ReaderSpec): boolean;
  transcribe(request: EvalTranscriptionRequest): Promise<TranscriptionResult>;
}

export type EvalSkipReason =
  | 'unsupported_format'
  | 'prompt_unsupported_format'
  | 'budget_exceeded'
  | 'image_error';

export type Overcorrection = 'equivalent_rewrite' | 'fixed_to_key';

export type ReaderRole = 'primary' | 'tiebreak';

export interface EvalReadingRecord {
  readonly readerKey: string;
  readonly family: string;
  readonly provider: ReaderSpec['provider'];
  readonly model: string;
  readonly promptRef: string;
  readonly promptHash: string | null;
  readonly role: ReaderRole;
  readonly repetition: number;
  readonly status: TranscriptionStatus;
  readonly errorCode: string | null;
  readonly state: ReadingState | null;
  readonly literal: string | null;
  readonly canonical: string | null;
  readonly confidence: number | null;
  readonly reviewRequested: boolean | null;
  readonly alternatives: ReadonlyArray<{ literal: string; plausibility: number }>;
  readonly transcriptionCorrect: boolean | null;
  readonly overcorrection: Overcorrection | null;
  readonly scoringOutcome: ScoringOutcome | null;
  readonly costUsd: number | null;
  readonly latencyMs: number;
  readonly providerModel: string;
}

export interface EvalDecisionRecord {
  readonly repetition: number;
  readonly outcome: ReadingOutcome;
  readonly reasons: readonly ReviewReason[];
  readonly reviewMode: ReviewMode | null;
  readonly canonical: string | null;
  readonly valueState: ReadingState | null;
  readonly decisionCorrect: boolean;
  readonly scoringOutcome: ScoringOutcome | null;
  readonly gradingCorrect: boolean | null;
  readonly readersAgree: boolean | null;
  readonly usedTiebreak: boolean;
}

export interface EvalSampleResult {
  readonly id: string;
  readonly image: string;
  readonly format: ResponseFormat;
  readonly tags: Readonly<Record<string, string>>;
  readonly gradeName: string | null;
  readonly truth: { state: ReadingState; literal: string; canonical: string | null };
  readonly expectedScoringOutcome: ScoringOutcome | null;
  readonly skipped: EvalSkipReason | null;
  readonly skipDetail: string | null;
  readonly readings: EvalReadingRecord[];
  readonly decisions: EvalDecisionRecord[];
}

export interface PreparedSample {
  readonly sample: EvalSample;
  readonly truth: LabelTruth;
  readonly scoreOf: ScoreOf;
  readonly expected: ScoringOutcome | null;
}

export function prepareSample(sample: EvalSample): PreparedSample {
  const truth = labelTruth(sample);
  const scoreOf = sampleScorer(sample, truth);
  const expected = isEvaluableFormat(sample.format)
    ? expectedScoringOutcome(sample, truth, scoreOf)
    : null;
  return { sample, truth, scoreOf, expected };
}

/** Motivo para no evaluar la muestra con esos lectores, o `null` si se puede. */
export function skipReasonFor(
  sample: EvalSample,
  readers: readonly ReaderSpec[],
): { reason: EvalSkipReason; detail: string } | null {
  if (!isEvaluableFormat(sample.format)) {
    return {
      reason: 'unsupported_format',
      detail: `El formato ${sample.format.kind} todavía no está en el registro`,
    };
  }
  for (const reader of readers) {
    if (!isTranscriptionPromptFor(reader.promptRef, sample.format.kind)) {
      return {
        reason: 'prompt_unsupported_format',
        detail: `El prompt ${reader.promptRef} no atiende el formato ${sample.format.kind}`,
      };
    }
  }
  return null;
}

export function skippedSampleResult(
  prepared: PreparedSample,
  reason: EvalSkipReason,
  detail: string,
): EvalSampleResult {
  return {
    ...sampleHeader(prepared),
    skipped: reason,
    skipDetail: detail,
    readings: [],
    decisions: [],
  };
}

function sampleHeader(prepared: PreparedSample) {
  const { sample, truth, expected } = prepared;
  return {
    id: sample.id,
    image: sample.image,
    format: sample.format,
    tags: sample.tags ?? {},
    gradeName: sample.gradeName ?? null,
    truth: { state: truth.state, literal: truth.literal, canonical: truth.canonical },
    expectedScoringOutcome: expected,
  };
}

export function readingKeyFor(sample: EvalSample, image: TranscriptionImage): string {
  return createHash('sha256')
    .update(`${image.sha256}:${JSON.stringify(sample.format)}`, 'utf8')
    .digest('hex');
}

export interface EvalRepetitionInput {
  readonly prepared: PreparedSample;
  readonly image: TranscriptionImage;
  readonly readers: readonly ReaderSpec[];
  readonly policy: ConsensusPolicy;
  readonly repetition: number;
  readonly transcriberFor: (reader: ReaderSpec) => EvalTranscriber | null;
}

export interface EvalRepetitionResult {
  readonly readings: EvalReadingRecord[];
  readonly decision: EvalDecisionRecord;
}

interface ReaderRun {
  readonly reader: ReaderSpec;
  readonly role: ReaderRole;
  readonly promptHash: string | null;
  readonly result: TranscriptionResult;
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

async function runReader(
  input: EvalRepetitionInput,
  reader: ReaderSpec,
  role: ReaderRole,
  readingKey: string,
): Promise<ReaderRun> {
  const { sample } = input.prepared;
  const transcriber = input.transcriberFor(reader);
  if (!transcriber) {
    return { reader, role, promptHash: null, result: failedResult(reader, 'no_transcriber') };
  }
  const rendered = renderTranscriptionPrompt(reader, sample.format, {
    gradeName: sample.gradeName ?? null,
  });
  const request: EvalTranscriptionRequest = {
    readingKey,
    image: input.image,
    reader,
    prompt: rendered.prompt,
    outputSchema: transcriptionZodSchema(sample.format),
    outputJsonSchema: rendered.outputSchema,
  };
  try {
    const result = await transcriber.transcribe(request);
    return { reader, role, promptHash: rendered.prompt.hash, result };
  } catch (error) {
    const code = error instanceof Error ? error.name || 'error' : 'error';
    return { reader, role, promptHash: rendered.prompt.hash, result: failedResult(reader, code) };
  }
}

function readingId(run: ReaderRun, repetition: number): string {
  return `${run.reader.key}#${run.role}#${repetition}`;
}

function toConsensusReading(run: ReaderRun, repetition: number): ConsensusReading {
  return {
    readingId: readingId(run, repetition),
    family: run.reader.family,
    status: run.result.status,
    output: run.result.status === 'ok' ? run.result.output : null,
    role: run.role,
    minConfidence: run.reader.minConfidence,
  };
}

/** Repite el texto sin espacios, con el signo menos unificado: la forma "escrita". */
export function writtenShape(literal: string): string {
  return literal.normalize('NFC').replace(/\s+/g, '').replace(/[−–—]/g, '-').toLowerCase();
}

function sameRational(a: CanonicalValue, b: CanonicalValue): boolean {
  if (
    (a.type !== 'number' && a.type !== 'fraction') ||
    (b.type !== 'number' && b.type !== 'fraction')
  ) {
    return false;
  }
  return a.value.numerator === b.value.numerator && a.value.denominator === b.value.denominator;
}

/** Igualdad matemática del valor leído y el de la etiqueta (sin mirar cómo se escribió). */
export function sameValue(a: CanonicalValue, b: CanonicalValue): boolean {
  if (a.type === 'tuple' && b.type === 'tuple') {
    return (
      a.components.length === b.components.length &&
      a.components.every((component, index) => {
        const other = b.components[index];
        return other !== undefined && sameRational(component, other);
      })
    );
  }
  if (a.type === 'sequence' && b.type === 'sequence') {
    return a.elements.join('|') === b.elements.join('|');
  }
  return sameRational(a, b);
}

/**
 * Sobrecorrección: el lector "arregló" lo escrito. `fixed_to_key` cuando la
 * etiqueta es incorrecta y la lectura es correcta; `equivalent_rewrite` cuando
 * el valor es el mismo pero cambió la escritura (separador, ceros, fracción
 * simplificada, fracción ↔ decimal).
 */
export function detectOvercorrection(
  truth: LabelTruth,
  expected: ScoringOutcome | null,
  literal: string,
  answer: NormalizedAnswer,
  outcome: ScoringOutcome | null,
): Overcorrection | null {
  if (truth.state !== 'answered' || answer.state !== 'answered') return null;
  if (expected !== null && expected !== 'correct' && outcome === 'correct') return 'fixed_to_key';
  const truthValue = truth.normalized?.value ?? null;
  if (truthValue === null || answer.value === null) return null;
  if (writtenShape(literal) === writtenShape(truth.literal)) return null;
  return sameValue(answer.value, truthValue) ? 'equivalent_rewrite' : null;
}

function isTranscriptionCorrect(truth: LabelTruth, answer: NormalizedAnswer): boolean {
  if (answer.state !== truth.state) return false;
  if (truth.state !== 'answered') return true;
  return answer.canonical !== null && answer.canonical === truth.canonical;
}

function readingRecord(run: ReaderRun, input: EvalRepetitionInput): EvalReadingRecord {
  const { prepared, repetition } = input;
  const { result, reader } = run;
  const base = {
    readerKey: reader.key,
    family: reader.family,
    provider: reader.provider,
    model: reader.model,
    promptRef: reader.promptRef,
    promptHash: run.promptHash,
    role: run.role,
    repetition,
    status: result.status,
    errorCode: result.errorCode,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
    providerModel: result.providerModel,
  };
  const output = result.status === 'ok' ? result.output : null;
  if (output === null) {
    return {
      ...base,
      state: null,
      literal: null,
      canonical: null,
      confidence: null,
      reviewRequested: null,
      alternatives: [],
      transcriptionCorrect: null,
      overcorrection: null,
      scoringOutcome: null,
    };
  }
  const answer = normalizeTranscription(output, prepared.sample.format);
  const outcome = answer.canonical !== null ? prepared.scoreOf(answer) : null;
  return {
    ...base,
    state: output.state,
    literal: output.literal,
    canonical: answer.canonical,
    confidence: output.confidence,
    reviewRequested: output.reviewRequested,
    alternatives: output.alternativeReadings.map(({ literal, plausibility }) => ({
      literal,
      plausibility,
    })),
    transcriptionCorrect: isTranscriptionCorrect(prepared.truth, answer),
    overcorrection: detectOvercorrection(
      prepared.truth,
      prepared.expected,
      output.literal,
      answer,
      outcome,
    ),
    scoringOutcome: outcome,
  };
}

function readersAgree(records: readonly EvalReadingRecord[]): boolean | null {
  const valid = records.filter((record) => record.role === 'primary' && record.state !== null);
  if (valid.length < 2) return null;
  const keys = new Set(
    valid.map((record) =>
      record.state === 'answered' ? `a:${record.canonical}` : `s:${record.state}`,
    ),
  );
  return (
    keys.size === 1 &&
    !valid.some((record) => record.state === 'answered' && record.canonical === null)
  );
}

function isDecisionCorrect(truth: LabelTruth, result: ConsensusResult): boolean {
  const value = result.value;
  if (value === null) return false;
  if (truth.state === 'blank') return value.state === 'blank';
  if (truth.state !== 'answered') return false;
  return (
    value.state === 'answered' && value.canonical !== null && value.canonical === truth.canonical
  );
}

function decisionRecord(
  result: ConsensusResult,
  records: readonly EvalReadingRecord[],
  input: EvalRepetitionInput,
  usedTiebreak: boolean,
): EvalDecisionRecord {
  const { prepared } = input;
  const scoringOutcome = result.scoringOutcome;
  return {
    repetition: input.repetition,
    outcome: result.outcome,
    reasons: result.reasons,
    reviewMode: result.reviewMode,
    canonical: result.value?.canonical ?? null,
    valueState: result.value?.state ?? null,
    decisionCorrect: isDecisionCorrect(prepared.truth, result),
    scoringOutcome,
    gradingCorrect:
      prepared.expected === null || scoringOutcome === null
        ? null
        : prepared.expected === scoringOutcome,
    readersAgree: readersAgree(records),
    usedTiebreak,
  };
}

/**
 * Una repetición de una muestra con el mismo flujo que producción: prompt
 * renderizado del registro, esquema del formato, normalización y
 * `evaluateConsensus` (con desempate si la política lo usa). La auditoría
 * muestral se apaga: el arnés mide todo lo que se autoaceptaría.
 */
export async function runEvalRepetition(input: EvalRepetitionInput): Promise<EvalRepetitionResult> {
  const { prepared, image, readers, repetition } = input;
  const readingKey = readingKeyFor(prepared.sample, image);
  const policy: ConsensusPolicy = { ...input.policy, auditSampleRate: 0 };
  const options = { format: prepared.sample.format, readingKey };

  const runs = await Promise.all(
    readers.map((reader) => runReader(input, reader, 'primary', readingKey)),
  );
  let readings = runs.map((run) => toConsensusReading(run, repetition));
  let result = evaluateConsensus(readings, policy, prepared.scoreOf, options);
  let usedTiebreak = false;

  if (policy.tiebreakReader !== null && needsTiebreak(result, readings, policy)) {
    const tiebreak = await runReader(input, policy.tiebreakReader, 'tiebreak', readingKey);
    runs.push(tiebreak);
    readings = [...readings, toConsensusReading(tiebreak, repetition)];
    result = evaluateConsensus(readings, policy, prepared.scoreOf, options);
    usedTiebreak = true;
  }

  const records = runs.map((run) => readingRecord(run, input));
  return { readings: records, decision: decisionRecord(result, records, input, usedTiebreak) };
}

export function sampleResult(
  prepared: PreparedSample,
  repetitions: readonly EvalRepetitionResult[],
): EvalSampleResult {
  return {
    ...sampleHeader(prepared),
    skipped: null,
    skipDetail: null,
    readings: repetitions.flatMap((repetition) => repetition.readings),
    decisions: repetitions.map((repetition) => repetition.decision),
  };
}
