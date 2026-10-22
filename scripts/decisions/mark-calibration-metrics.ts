/**
 * Parte pura de la calibración de la desambiguación de marcas (sin BDD ni red):
 * arma los casos, simula `pairConsensus` con el veto de dominio, busca umbrales
 * sobre una grilla y calcula cobertura, errores, cota superior y cortes de §7.3.
 */
import {
  pairConsensus,
  type PairSide,
  type PairThresholds,
} from '../../packages/decisions/src/index';
import { MARK_ANSWER_BLANK, MARK_ANSWER_NULL } from '@soe/types';
import { percentile } from './calibration-metrics';

export const MARK_BLANK = MARK_ANSWER_BLANK;
export const PROVISIONAL_JEV: PairThresholds = { agree: 0.6, solo: 0.85, unsure: 0.5 };
export const PROVISIONAL_OPENAI: PairThresholds = { agree: 0.5, solo: 0.8, unsure: 0.5 };

export type EngineKey = 'jev' | 'openai';

export interface EngineCall {
  status: 'ok' | 'error';
  errorCode: string | null;
  choice: string | null;
  confidence: number | null;
  optionKeys: string[];
  latencyMs: number | null;
}

export interface MarkCase {
  markId: string;
  omrState: string;
  doubtReason: string | null;
  margin: number;
  captureSource: string;
  truth: string | null;
  truthKind: 'human' | 'weak';
  jev: EngineCall | null;
  openai: EngineCall | null;
}

export interface Outcome {
  auto: boolean;
  choice: string | null;
  verdict: string;
}

export interface SliceStats {
  n: number;
  auto: number;
  errors: number;
  coverage: number | null;
  upperBound95: number | null;
}

export interface ThresholdPair {
  jev: PairThresholds;
  openai: PairThresholds;
}

export interface Evaluation extends SliceStats {
  thresholds: ThresholdPair;
  verdicts: Record<string, number>;
}

export interface SliceReport {
  name: string;
  stats: SliceStats;
  meetsCriterion: boolean;
}

export interface EngineHealth {
  calls: number;
  failed: number;
  failureRate: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  missingForMarks: number;
}

export function optionsOf(markCase: MarkCase): string[] {
  const keys = markCase.jev?.optionKeys.length
    ? markCase.jev.optionKeys
    : (markCase.openai?.optionKeys ?? []);
  return keys;
}

export function bubbleCount(markCase: MarkCase): number {
  return optionsOf(markCase).filter((key) => key !== MARK_BLANK && key !== MARK_ANSWER_NULL).length;
}

function toSide(call: EngineCall | null): PairSide {
  if (!call) return { status: 'failed', code: 'dropped' };
  if (call.status !== 'ok' || call.choice === null || call.confidence === null) {
    return { status: 'failed', code: 'dropped' };
  }
  return {
    status: 'ok',
    answer: {
      type: 'choice',
      choice: call.choice,
      probabilities: { [call.choice]: 1 },
      confidence: call.confidence,
    },
  };
}

export function simulateCase(markCase: MarkCase, thresholds: ThresholdPair): Outcome {
  const consensus = pairConsensus(
    toSide(markCase.jev),
    toSide(markCase.openai),
    thresholds.jev,
    thresholds.openai,
    optionsOf(markCase),
  );
  if (
    consensus.route === 'auto' &&
    markCase.omrState === 'multiple' &&
    consensus.choice === MARK_BLANK
  ) {
    return { auto: false, choice: null, verdict: 'vetoed' };
  }
  return { auto: consensus.route === 'auto', choice: consensus.choice, verdict: consensus.verdict };
}

export function upperBound95(auto: number, errors: number): number | null {
  if (auto === 0) return null;
  if (errors === 0) return 3 / auto;
  const z = 1.96;
  const p = errors / auto;
  const denominator = 1 + (z * z) / auto;
  const center = p + (z * z) / (2 * auto);
  const margin = z * Math.sqrt((p * (1 - p)) / auto + (z * z) / (4 * auto * auto));
  return Math.min(1, (center + margin) / denominator);
}

export function evaluate(cases: readonly MarkCase[], thresholds: ThresholdPair): Evaluation {
  const verdicts: Record<string, number> = {};
  let auto = 0;
  let errors = 0;
  for (const markCase of cases) {
    const outcome = simulateCase(markCase, thresholds);
    verdicts[outcome.verdict] = (verdicts[outcome.verdict] ?? 0) + 1;
    if (!outcome.auto) continue;
    auto += 1;
    if (outcome.choice !== markCase.truth) errors += 1;
  }
  return { thresholds, verdicts, ...statsOf(cases.length, auto, errors) };
}

export function statsOf(n: number, auto: number, errors: number): SliceStats {
  return {
    n,
    auto,
    errors,
    coverage: n === 0 ? null : auto / n,
    upperBound95: upperBound95(auto, errors),
  };
}

export function thresholdGrid(step: number): PairThresholds[] {
  const values: number[] = [];
  for (let i = 0; i * step <= 1 + 1e-9; i++) values.push(Math.round(i * step * 1e6) / 1e6);
  const grid: PairThresholds[] = [];
  for (const unsure of values) {
    for (const agree of values) {
      if (agree < unsure) continue;
      for (const solo of values) {
        if (solo < agree) continue;
        grid.push({ agree, solo, unsure });
      }
    }
  }
  return grid;
}

interface PackedCases {
  n: number;
  okA: Uint8Array;
  okB: Uint8Array;
  pa: Float64Array;
  pb: Float64Array;
  ca: Int32Array;
  cb: Int32Array;
  truth: Int32Array;
  blankId: number;
  vetoable: Uint8Array;
}

function packCases(cases: readonly MarkCase[]): PackedCases {
  const ids = new Map<string, number>();
  const idOf = (value: string | null): number => {
    if (value === null) return -1;
    const existing = ids.get(value);
    if (existing !== undefined) return existing;
    ids.set(value, ids.size);
    return ids.size - 1;
  };
  const blankId = idOf(MARK_BLANK);
  const n = cases.length;
  const packed: PackedCases = {
    n,
    okA: new Uint8Array(n),
    okB: new Uint8Array(n),
    pa: new Float64Array(n),
    pb: new Float64Array(n),
    ca: new Int32Array(n),
    cb: new Int32Array(n),
    truth: new Int32Array(n),
    blankId,
    vetoable: new Uint8Array(n),
  };
  cases.forEach((markCase, i) => {
    const options = new Set(optionsOf(markCase));
    const usable = (call: MarkCase['jev']): boolean =>
      call !== null &&
      call.status === 'ok' &&
      call.choice !== null &&
      options.has(call.choice) &&
      call.confidence !== null &&
      Number.isFinite(call.confidence) &&
      call.confidence >= 0 &&
      call.confidence <= 1;
    packed.okA[i] = usable(markCase.jev) ? 1 : 0;
    packed.okB[i] = usable(markCase.openai) ? 1 : 0;
    packed.pa[i] = markCase.jev?.confidence ?? 0;
    packed.pb[i] = markCase.openai?.confidence ?? 0;
    packed.ca[i] = idOf(markCase.jev?.choice ?? null);
    packed.cb[i] = idOf(markCase.openai?.choice ?? null);
    packed.truth[i] = idOf(markCase.truth);
    packed.vetoable[i] = markCase.omrState === 'multiple' ? 1 : 0;
  });
  return packed;
}

export interface SearchResult {
  best: Evaluation | null;
  bestFast: { auto: number; errors: number } | null;
  combinationsTried: number;
}

export function searchBestThresholds(
  cases: readonly MarkCase[],
  grid: readonly PairThresholds[],
  maxErrors: number,
): SearchResult {
  const packed = packCases(cases);
  let bestAuto = -1;
  let bestErrors = Number.POSITIVE_INFINITY;
  let bestWeight = -1;
  let bestPair: ThresholdPair | null = null;
  let combinationsTried = 0;
  for (const ta of grid) {
    for (const tb of grid) {
      combinationsTried += 1;
      let auto = 0;
      let errors = 0;
      for (let i = 0; i < packed.n && errors <= maxErrors; i++) {
        if (!packed.okA[i] || !packed.okB[i]) continue;
        const pa = packed.pa[i] as number;
        const pb = packed.pb[i] as number;
        const ca = packed.ca[i] as number;
        const cb = packed.cb[i] as number;
        let choice = -1;
        if (ca === cb) {
          if (pa >= ta.agree && pb >= tb.agree) choice = ca;
        } else if (pa >= ta.solo && pb < tb.unsure) choice = ca;
        else if (pb >= tb.solo && pa < ta.unsure) choice = cb;
        if (choice < 0) continue;
        if (choice === packed.blankId && packed.vetoable[i]) continue;
        auto += 1;
        if (choice !== packed.truth[i]) errors += 1;
      }
      if (errors > maxErrors) continue;
      const weight = ta.agree + ta.solo + ta.unsure + tb.agree + tb.solo + tb.unsure;
      const better =
        auto > bestAuto ||
        (auto === bestAuto && errors < bestErrors) ||
        (auto === bestAuto && errors === bestErrors && weight > bestWeight);
      if (better) {
        bestAuto = auto;
        bestErrors = errors;
        bestWeight = weight;
        bestPair = { jev: ta, openai: tb };
      }
    }
  }
  return {
    best: bestPair ? evaluate(cases, bestPair) : null,
    bestFast: bestPair ? { auto: bestAuto, errors: bestErrors } : null,
    combinationsTried,
  };
}

export interface SliceDefinition {
  name: string;
  predicate: (markCase: MarkCase) => boolean;
}

export function sliceDefinitions(cases: readonly MarkCase[]): SliceDefinition[] {
  const sources = [...new Set(cases.map((markCase) => markCase.captureSource))].sort();
  return [
    { name: 'verdad annulled (nulas reales)', predicate: (c) => c.truth === MARK_ANSWER_NULL },
    { name: 'verdad blank', predicate: (c) => c.truth === MARK_BLANK },
    {
      name: 'marcas débiles (doubt_reason margin/band y margin < 0,1)',
      predicate: (c) => (c.doubtReason === 'margin' || c.doubtReason === 'band') && c.margin < 0.1,
    },
    { name: 'doubt_reason = multiple', predicate: (c) => c.doubtReason === 'multiple' },
    ...sources.map((source) => ({
      name: `captura: ${source}`,
      predicate: (c: MarkCase) => c.captureSource === source,
    })),
    { name: 'campos con >= 5 opciones', predicate: (c) => bubbleCount(c) >= 5 },
    { name: 'campos con < 5 opciones', predicate: (c) => bubbleCount(c) < 5 },
  ];
}

export const SLICE_MIN_N = 30;

export function sliceReports(cases: readonly MarkCase[], thresholds: ThresholdPair): SliceReport[] {
  return sliceDefinitions(cases).map(({ name, predicate }) => {
    const subset = cases.filter(predicate);
    const { n, auto, errors, coverage, upperBound95: bound } = evaluate(subset, thresholds);
    return {
      name,
      stats: { n, auto, errors, coverage, upperBound95: bound },
      meetsCriterion: n >= SLICE_MIN_N && errors === 0,
    };
  });
}

export function engineHealth(cases: readonly MarkCase[], engine: EngineKey): EngineHealth {
  const calls = cases.map((markCase) => markCase[engine]);
  const present = calls.filter((call): call is EngineCall => call !== null);
  const failed = present.filter((call) => call.status !== 'ok' || call.choice === null).length;
  const latencies = present
    .map((call) => call.latencyMs)
    .filter((latency): latency is number => latency !== null);
  return {
    calls: present.length,
    failed,
    failureRate: present.length === 0 ? null : failed / present.length,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    missingForMarks: calls.length - present.length,
  };
}

export interface WeakTruthReport {
  n: number;
  auto: number;
  agreeWithNull: number;
}

export function weakTruthReport(
  cases: readonly MarkCase[],
  thresholds: ThresholdPair,
): WeakTruthReport {
  let auto = 0;
  let agreeWithNull = 0;
  for (const markCase of cases) {
    const outcome = simulateCase(markCase, thresholds);
    if (!outcome.auto) continue;
    auto += 1;
    if (outcome.choice === markCase.truth) agreeWithNull += 1;
  }
  return { n: cases.length, auto, agreeWithNull };
}

export function assertSameAsPairConsensus(
  evaluation: Evaluation,
  fast: { auto: number; errors: number },
): void {
  if (evaluation.auto !== fast.auto || evaluation.errors !== fast.errors) {
    throw new Error(
      `La búsqueda rápida (${fast.auto} auto, ${fast.errors} errores) no coincide con pairConsensus (${evaluation.auto}, ${evaluation.errors})`,
    );
  }
}
