import type { ReadingOutcome, ResponseFormatKind, ReviewReason } from '@soe/types';
import type {
  AutoAcceptedErrorKind,
  ReadingRecord,
  SimulationResult,
  SkipReason,
  UnitRecord,
} from './simulate';
import {
  mean,
  mcnemarExact,
  proportion,
  quantile,
  type McNemarResult,
  type Proportion,
} from './statistics';

export const HIGH_CONFIDENCE_THRESHOLDS = [0.85, 0.97] as const;

export interface Latency {
  readonly p50: number | null;
  readonly p95: number | null;
}

export interface ReaderShortMetrics {
  readonly readings: number;
  readonly failed: number;
  readonly exact: Proportion;
  readonly exactByFormat: Readonly<Partial<Record<ResponseFormatKind, Proportion>>>;
  readonly stability: Proportion;
  readonly meanConfidenceExact: number | null;
  readonly meanConfidenceWrong: number | null;
  readonly exactAtConfidence: Readonly<Record<string, Proportion>>;
  readonly reviewRequestedWhenExact: Proportion;
  readonly reviewRequestedWhenWrong: Proportion;
}

export interface ReaderDevelopmentMetrics {
  readonly readings: number;
  readonly failed: number;
  readonly fidelityMean: number | null;
  readonly fidelityMin: number | null;
  readonly fidelityBySample: Readonly<Record<string, number | null>>;
}

export interface ReaderMetrics {
  readonly readerKey: string;
  readonly provider: string;
  readonly model: string;
  readonly promptRefs: readonly string[];
  readonly role: 'primary' | 'tiebreak';
  readonly short: ReaderShortMetrics | null;
  readonly development: ReaderDevelopmentMetrics | null;
  readonly fromCache: number;
  readonly nominalCostUsd: number;
  readonly costPerReadingUsd: number | null;
  readonly latencyMs: Latency;
}

export interface AutoAcceptedError {
  readonly sampleId: string;
  readonly repetition: number;
  readonly formatKind: ResponseFormatKind;
  readonly accepted: string | null;
  readonly truth: string | null;
  readonly kind: 'harms' | 'favors' | 'neutral';
  readonly pointsDelta: number | null;
}

export interface ShortDecisionMetrics {
  readonly units: number;
  readonly autoAccepted: Proportion;
  readonly autoAcceptedCorrect: number;
  readonly autoAcceptedWrong: Proportion;
  readonly autoAcceptedWrongOverUnits: Proportion;
  readonly harmsStudent: { readonly count: number; readonly points: number };
  readonly favorsStudent: { readonly count: number; readonly points: number };
  readonly wrongWithoutScoreEffect: number;
  readonly review: Proportion;
  readonly reviewByReason: Readonly<Partial<Record<ReviewReason, number>>>;
  readonly notRead: number;
  readonly readerThresholdApplied: number;
  readonly byFormat: Readonly<
    Partial<Record<ResponseFormatKind, { units: number; autoAccepted: Proportion; wrong: number }>>
  >;
  readonly errors: readonly AutoAcceptedError[];
}

export interface DevelopmentDecisionMetrics {
  readonly units: number;
  readonly autoAccepted: number;
  readonly reviewByReason: Readonly<Partial<Record<ReviewReason, number>>>;
}

export type VerifiedCaseKind = 'unfair_zero' | 'true_incorrect' | 'other_error';

export interface VerifiedCase {
  readonly sampleId: string;
  readonly repetition: number;
  readonly formatKind: ResponseFormatKind;
  readonly accepted: string | null;
  readonly truth: string | null;
  readonly kind: VerifiedCaseKind;
  readonly status: string | null;
  readonly couldBeKey: boolean | null;
  readonly confidence: number | null;
  readonly flagged: boolean;
}

export interface VerifierMetrics {
  readonly readerKeys: readonly string[];
  readonly checked: number;
  readonly called: number;
  readonly fromCache: number;
  readonly failed: number;
  readonly flagged: Proportion;
  readonly unfairZeros: { readonly before: number; readonly caught: Proportion };
  readonly falseAlarms: Proportion;
  readonly otherErrors: { readonly before: number; readonly flagged: number };
  readonly autoAcceptedIncorrect: { readonly before: number; readonly after: number };
  readonly harmsStudent: { readonly before: number; readonly after: number };
  readonly extraCostUsd: number;
  readonly extraCostPerShortCropUsd: number | null;
  readonly cases: readonly VerifiedCase[];
}

export interface AuditedCase {
  readonly sampleId: string;
  readonly repetition: number;
  readonly formatKind: ResponseFormatKind;
  readonly candidate: string | null;
  readonly truth: string | null;
  readonly status: string | null;
  readonly verdict: string | null;
  readonly confidence: number | null;
  readonly suspiciousCharacters: readonly string[];
  readonly approved: boolean;
  readonly accepted: boolean;
  readonly finalOutcome: ReadingOutcome;
  readonly finalError: AutoAcceptedErrorKind | null;
}

export interface AuditorMetrics {
  readonly readerKeys: readonly string[];
  readonly audited: number;
  readonly called: number;
  readonly fromCache: number;
  readonly failed: number;
  readonly approved: number;
  readonly accepted: number;
  readonly autoAcceptedAfterVerifier: number;
  readonly acceptedWrong: number;
  readonly acceptedHarms: number;
  readonly candidateCorrect: Proportion;
  readonly approvedWhenCandidateCorrect: Proportion;
  readonly approvedWhenCandidateWrong: Proportion;
  readonly extraCostUsd: number;
  readonly extraCostPerShortCropUsd: number | null;
  readonly cases: readonly AuditedCase[];
}

export interface EvalMetricsV2 {
  readonly samples: {
    readonly total: number;
    readonly evaluated: number;
    readonly skipped: Readonly<Partial<Record<SkipReason, number>>>;
  };
  readonly short: ShortDecisionMetrics;
  readonly verifier: VerifierMetrics | null;
  readonly auditor: AuditorMetrics | null;
  readonly development: DevelopmentDecisionMetrics;
  readonly readers: readonly ReaderMetrics[];
  readonly cost: {
    readonly nominalTotalUsd: number;
    readonly nominalPerCropUsd: number | null;
    readonly nominalPerShortCropUsd: number | null;
    readonly nominalPerDevelopmentCropUsd: number | null;
    readonly spentUsd: number;
    readonly apiCalls: number;
    readonly readingsFromCache: number;
    readonly readingsTotal: number;
  };
  readonly latencyMs: { readonly perReading: Latency; readonly perCrop: Latency };
}

function latencyOf(values: readonly number[]): Latency {
  return { p50: quantile(values, 0.5), p95: quantile(values, 0.95) };
}

function countBy<T, K extends string>(items: readonly T[], keysOf: (item: T) => readonly K[]) {
  const counts: Partial<Record<K, number>> = {};
  for (const item of items) {
    for (const key of keysOf(item)) counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function readingSignature(reading: ReadingRecord): string {
  if (reading.status !== 'ok') return `!${reading.status}`;
  if (reading.state !== 'answered') return `s:${reading.state}`;
  return reading.canonical ?? `∅${reading.literal ?? ''}`;
}

function stabilityOf(readings: readonly ReadingRecord[]): Proportion {
  let stable = 0;
  let total = 0;
  for (const bySample of groupBy(readings, (reading) => reading.sampleId).values()) {
    if (bySample.length < 2) continue;
    total += 1;
    if (new Set(bySample.map(readingSignature)).size === 1) stable += 1;
  }
  return proportion(stable, total);
}

function shortReaderMetrics(readings: readonly ReadingRecord[]): ReaderShortMetrics | null {
  if (readings.length === 0) return null;
  const ok = readings.filter((reading) => reading.exact !== null);
  const exact = ok.filter((reading) => reading.exact === true);
  const wrong = ok.filter((reading) => reading.exact === false);
  const exactByFormat: Partial<Record<ResponseFormatKind, Proportion>> = {};
  for (const [kind, list] of groupBy(ok, (reading) => reading.formatKind)) {
    exactByFormat[kind as ResponseFormatKind] = proportion(
      list.filter((reading) => reading.exact === true).length,
      list.length,
    );
  }
  const exactAtConfidence: Record<string, Proportion> = {};
  for (const threshold of HIGH_CONFIDENCE_THRESHOLDS) {
    const confident = ok.filter((reading) => (reading.confidence ?? 0) >= threshold);
    exactAtConfidence[String(threshold)] = proportion(
      confident.filter((reading) => reading.exact === true).length,
      confident.length,
    );
  }
  const confidences = (list: readonly ReadingRecord[]) =>
    list.map((reading) => reading.confidence ?? 0);
  const requested = (list: readonly ReadingRecord[]) =>
    proportion(list.filter((reading) => reading.reviewRequested === true).length, list.length);
  return {
    readings: readings.length,
    failed: readings.length - ok.length,
    exact: proportion(exact.length, readings.length),
    exactByFormat,
    stability: stabilityOf(readings),
    meanConfidenceExact: mean(confidences(exact)),
    meanConfidenceWrong: mean(confidences(wrong)),
    exactAtConfidence,
    reviewRequestedWhenExact: requested(exact),
    reviewRequestedWhenWrong: requested(wrong),
  };
}

function developmentReaderMetrics(
  readings: readonly ReadingRecord[],
): ReaderDevelopmentMetrics | null {
  if (readings.length === 0) return null;
  const fidelities = readings
    .map((reading) => reading.fidelity)
    .filter((value): value is number => value !== null);
  const fidelityBySample: Record<string, number | null> = {};
  for (const [sampleId, list] of groupBy(readings, (reading) => reading.sampleId)) {
    fidelityBySample[sampleId] = mean(
      list.map((reading) => reading.fidelity).filter((value): value is number => value !== null),
    );
  }
  return {
    readings: readings.length,
    failed: readings.filter((reading) => reading.status !== 'ok').length,
    fidelityMean: mean(fidelities),
    fidelityMin: fidelities.length > 0 ? Math.min(...fidelities) : null,
    fidelityBySample,
  };
}

function readerMetrics(readings: readonly ReadingRecord[]): ReaderMetrics[] {
  return [...groupBy(readings, (reading) => `${reading.role}|${reading.readerKey}`).values()].map(
    (list) => {
      const first = list[0]!;
      const costs = list.map((reading) => reading.costUsd ?? 0);
      const nominalCostUsd = costs.reduce((sum, cost) => sum + cost, 0);
      return {
        readerKey: first.readerKey,
        provider: first.provider,
        model: first.model,
        promptRefs: [...new Set(list.map((reading) => reading.promptRef))].sort(),
        role: first.role,
        short: shortReaderMetrics(list.filter((reading) => reading.group === 'short')),
        development: developmentReaderMetrics(
          list.filter((reading) => reading.group === 'development'),
        ),
        fromCache: list.filter((reading) => reading.fromCache).length,
        nominalCostUsd,
        costPerReadingUsd: list.length > 0 ? nominalCostUsd / list.length : null,
        latencyMs: latencyOf(list.map((reading) => reading.latencyMs)),
      };
    },
  );
}

function shortDecisionMetrics(
  units: readonly UnitRecord[],
  truthBySample: ReadonlyMap<string, string | null>,
): ShortDecisionMetrics {
  const auto = units.filter((unit) => unit.autoAccepted);
  const wrong = auto.filter((unit) => unit.autoAcceptedError !== null);
  const harms = wrong.filter((unit) => unit.autoAcceptedError === 'harms');
  const favors = wrong.filter((unit) => unit.autoAcceptedError === 'favors');
  const review = units.filter((unit) => unit.outcome === 'needs_review');
  const byFormat: Partial<
    Record<ResponseFormatKind, { units: number; autoAccepted: Proportion; wrong: number }>
  > = {};
  for (const [kind, list] of groupBy(units, (unit) => unit.formatKind)) {
    byFormat[kind as ResponseFormatKind] = {
      units: list.length,
      autoAccepted: proportion(list.filter((unit) => unit.autoAccepted).length, list.length),
      wrong: list.filter((unit) => unit.autoAcceptedError !== null).length,
    };
  }
  const points = (list: readonly UnitRecord[]) =>
    list.reduce((sum, unit) => sum + (unit.pointsDelta ?? 0), 0);
  return {
    units: units.length,
    autoAccepted: proportion(auto.length, units.length),
    autoAcceptedCorrect: auto.length - wrong.length,
    autoAcceptedWrong: proportion(wrong.length, auto.length),
    autoAcceptedWrongOverUnits: proportion(wrong.length, units.length),
    harmsStudent: { count: harms.length, points: points(harms) },
    favorsStudent: { count: favors.length, points: points(favors) },
    wrongWithoutScoreEffect: wrong.length - harms.length - favors.length,
    review: proportion(review.length, units.length),
    reviewByReason: countBy(review, (unit) => unit.reasons),
    notRead: units.filter((unit) => unit.outcome === 'not_read').length,
    readerThresholdApplied: units.filter((unit) => unit.readerThresholdApplied).length,
    byFormat,
    errors: wrong.map((unit) => ({
      sampleId: unit.sampleId,
      repetition: unit.repetition,
      formatKind: unit.formatKind,
      accepted: unit.canonical,
      truth: truthBySample.get(unit.sampleId) ?? null,
      kind: unit.autoAcceptedError ?? 'neutral',
      pointsDelta: unit.pointsDelta,
    })),
  };
}

function verifiedCaseKind(unit: UnitRecord): VerifiedCaseKind {
  if (unit.beforeVerifier?.autoAcceptedError === 'harms') return 'unfair_zero';
  return unit.decisionCorrect ? 'true_incorrect' : 'other_error';
}

function verifierMetrics(
  shortUnits: readonly UnitRecord[],
  truthBySample: ReadonlyMap<string, string | null>,
): VerifierMetrics | null {
  const checked = shortUnits.filter((unit) => unit.verifier !== null);
  if (checked.length === 0) return null;
  const cases: VerifiedCase[] = checked.map((unit) => ({
    sampleId: unit.sampleId,
    repetition: unit.repetition,
    formatKind: unit.formatKind,
    accepted: unit.canonical,
    truth: truthBySample.get(unit.sampleId) ?? null,
    kind: verifiedCaseKind(unit),
    status: unit.verifier?.status ?? null,
    couldBeKey: unit.verifier?.couldBeKey ?? null,
    confidence: unit.verifier?.confidence ?? null,
    flagged: unit.verifier?.flagged ?? false,
  }));
  const ofKind = (kind: VerifiedCaseKind) => cases.filter((entry) => entry.kind === kind);
  const flaggedIn = (list: readonly VerifiedCase[]) => list.filter((entry) => entry.flagged).length;
  const unfair = ofKind('unfair_zero');
  const trueIncorrect = ofKind('true_incorrect');
  const other = ofKind('other_error');
  const extraCostUsd = checked.reduce((sum, unit) => sum + (unit.verifier?.costUsd ?? 0), 0);
  const harmsAfter = shortUnits.filter((unit) => unit.autoAcceptedError === 'harms').length;
  const harmsBefore = shortUnits.filter(
    (unit) => (unit.beforeVerifier ?? unit).autoAcceptedError === 'harms',
  ).length;
  return {
    readerKeys: [...new Set(checked.map((unit) => unit.verifier?.readerKey ?? ''))].sort(),
    checked: checked.length,
    called: checked.filter((unit) => unit.verifier?.called).length,
    fromCache: checked.filter((unit) => unit.verifier?.fromCache).length,
    failed: checked.filter((unit) => unit.verifier?.status !== 'ok').length,
    flagged: proportion(flaggedIn(cases), cases.length),
    unfairZeros: { before: unfair.length, caught: proportion(flaggedIn(unfair), unfair.length) },
    falseAlarms: proportion(flaggedIn(trueIncorrect), trueIncorrect.length),
    otherErrors: { before: other.length, flagged: flaggedIn(other) },
    autoAcceptedIncorrect: {
      before: checked.length,
      after: checked.filter((unit) => !unit.verifier?.flagged).length,
    },
    harmsStudent: { before: harmsBefore, after: harmsAfter },
    extraCostUsd,
    extraCostPerShortCropUsd: shortUnits.length > 0 ? extraCostUsd / shortUnits.length : null,
    cases,
  };
}

function auditorMetrics(
  shortUnits: readonly UnitRecord[],
  truthBySample: ReadonlyMap<string, string | null>,
): AuditorMetrics | null {
  const audited = shortUnits.filter((unit) => unit.auditor !== null);
  if (audited.length === 0) return null;
  const cases: AuditedCase[] = audited.map((unit) => ({
    sampleId: unit.sampleId,
    repetition: unit.repetition,
    formatKind: unit.formatKind,
    candidate: unit.auditor?.candidate ?? null,
    truth: truthBySample.get(unit.sampleId) ?? null,
    status: unit.auditor?.status ?? null,
    verdict: unit.auditor?.verdict ?? null,
    confidence: unit.auditor?.confidence ?? null,
    suspiciousCharacters: unit.auditor?.suspiciousCharacters ?? [],
    approved: unit.auditor?.approved ?? false,
    accepted: unit.auditor?.accepted ?? false,
    finalOutcome: unit.outcome,
    finalError: unit.autoAcceptedError,
  }));
  const withCandidate = cases.filter((entry) => entry.candidate !== null);
  const correct = withCandidate.filter((entry) => entry.candidate === entry.truth);
  const wrong = withCandidate.filter((entry) => entry.candidate !== entry.truth);
  const approvedIn = (list: readonly AuditedCase[]) =>
    list.filter((entry) => entry.approved).length;
  const accepted = audited.filter((unit) => unit.auditor?.accepted);
  const finallyAccepted = accepted.filter((unit) => unit.autoAccepted);
  const extraCostUsd = audited.reduce((sum, unit) => sum + (unit.auditor?.costUsd ?? 0), 0);
  return {
    readerKeys: [...new Set(audited.map((unit) => unit.auditor?.readerKey ?? ''))].sort(),
    audited: audited.length,
    called: audited.filter((unit) => unit.auditor?.called).length,
    fromCache: audited.filter((unit) => unit.auditor?.fromCache).length,
    failed: audited.filter((unit) => unit.auditor?.status !== 'ok').length,
    approved: audited.filter((unit) => unit.auditor?.approved).length,
    accepted: accepted.length,
    autoAcceptedAfterVerifier: finallyAccepted.length,
    acceptedWrong: finallyAccepted.filter((unit) => unit.autoAcceptedError !== null).length,
    acceptedHarms: finallyAccepted.filter((unit) => unit.autoAcceptedError === 'harms').length,
    candidateCorrect: proportion(correct.length, withCandidate.length),
    approvedWhenCandidateCorrect: proportion(approvedIn(correct), correct.length),
    approvedWhenCandidateWrong: proportion(approvedIn(wrong), wrong.length),
    extraCostUsd,
    extraCostPerShortCropUsd: shortUnits.length > 0 ? extraCostUsd / shortUnits.length : null,
    cases,
  };
}

export function computeMetrics(
  result: SimulationResult,
  cacheStats: { hits: number },
): EvalMetricsV2 {
  const shortUnits = result.units.filter((unit) => unit.group === 'short');
  const developmentUnits = result.units.filter((unit) => unit.group === 'development');
  const truthBySample = new Map(
    result.samples.map((sample) => [sample.id, sample.truth.canonical]),
  );
  const nominal = (units: readonly UnitRecord[]) =>
    units.reduce((sum, unit) => sum + unit.costUsd, 0);
  const perCrop = (units: readonly UnitRecord[]) =>
    units.length > 0 ? nominal(units) / units.length : null;
  const skipped = result.samples.filter((sample) => sample.skipped !== null);
  return {
    samples: {
      total: result.samples.length,
      evaluated: result.samples.length - skipped.length,
      skipped: countBy(skipped, (sample) => (sample.skipped ? [sample.skipped] : [])),
    },
    short: shortDecisionMetrics(shortUnits, truthBySample),
    verifier: verifierMetrics(shortUnits, truthBySample),
    auditor: auditorMetrics(shortUnits, truthBySample),
    development: {
      units: developmentUnits.length,
      autoAccepted: developmentUnits.filter((unit) => unit.autoAccepted).length,
      reviewByReason: countBy(
        developmentUnits.filter((unit) => unit.outcome === 'needs_review'),
        (unit) => unit.reasons,
      ),
    },
    readers: readerMetrics(result.readings),
    cost: {
      nominalTotalUsd: nominal(result.units),
      nominalPerCropUsd: perCrop(result.units),
      nominalPerShortCropUsd: perCrop(shortUnits),
      nominalPerDevelopmentCropUsd: perCrop(developmentUnits),
      spentUsd: result.spentUsd,
      apiCalls: result.apiCalls,
      readingsFromCache: cacheStats.hits,
      readingsTotal: result.readings.length,
    },
    latencyMs: {
      perReading: latencyOf(result.readings.map((reading) => reading.latencyMs)),
      perCrop: latencyOf(result.units.map((unit) => unit.latencyMs)),
    },
  };
}

export interface PairedMetric {
  readonly metric: string;
  readonly before: Proportion;
  readonly after: Proportion;
  readonly both: number;
  readonly neither: number;
  readonly mcnemar: McNemarResult;
}

export interface ChangedUnit {
  readonly sampleId: string;
  readonly repetition: number;
  readonly before: Pick<UnitRecord, 'outcome' | 'reasons' | 'canonical' | 'autoAcceptedError'>;
  readonly after: Pick<UnitRecord, 'outcome' | 'reasons' | 'canonical' | 'autoAcceptedError'>;
}

export interface PairedComparison {
  readonly pairedUnits: number;
  readonly onlyBefore: number;
  readonly onlyAfter: number;
  readonly metrics: readonly PairedMetric[];
  readonly changedUnits: readonly ChangedUnit[];
}

const PAIRED_INDICATORS: ReadonlyArray<{ metric: string; of: (unit: UnitRecord) => boolean }> = [
  { metric: 'Autoaceptadas', of: (unit) => unit.autoAccepted },
  { metric: 'Autoaceptadas equivocadas', of: (unit) => unit.autoAcceptedError !== null },
  {
    metric: 'Autoaceptadas que perjudican al alumno',
    of: (unit) => unit.autoAcceptedError === 'harms',
  },
  {
    metric: 'Autoaceptadas que favorecen al alumno',
    of: (unit) => unit.autoAcceptedError === 'favors',
  },
  { metric: 'Decisión con el valor correcto', of: (unit) => unit.decisionCorrect },
];

function unitKey(unit: Pick<UnitRecord, 'sampleId' | 'repetition'>): string {
  return `${unit.sampleId}#${unit.repetition}`;
}

function decisionSummary(
  unit: UnitRecord,
): Pick<UnitRecord, 'outcome' | 'reasons' | 'canonical' | 'autoAcceptedError'> {
  return {
    outcome: unit.outcome,
    reasons: unit.reasons,
    canonical: unit.canonical,
    autoAcceptedError: unit.autoAcceptedError,
  };
}

export function comparePaired(
  beforeUnits: readonly UnitRecord[],
  afterUnits: readonly UnitRecord[],
): PairedComparison {
  const before = new Map(
    beforeUnits.filter((unit) => unit.group === 'short').map((unit) => [unitKey(unit), unit]),
  );
  const after = new Map(
    afterUnits.filter((unit) => unit.group === 'short').map((unit) => [unitKey(unit), unit]),
  );
  const pairs: Array<[UnitRecord, UnitRecord]> = [];
  for (const [key, unit] of before) {
    const other = after.get(key);
    if (other) pairs.push([unit, other]);
  }
  const metrics = PAIRED_INDICATORS.map(({ metric, of }) => {
    let onlyBefore = 0;
    let onlyAfter = 0;
    let both = 0;
    for (const [a, b] of pairs) {
      const x = of(a);
      const y = of(b);
      if (x && y) both += 1;
      else if (x) onlyBefore += 1;
      else if (y) onlyAfter += 1;
    }
    return {
      metric,
      before: proportion(both + onlyBefore, pairs.length),
      after: proportion(both + onlyAfter, pairs.length),
      both,
      neither: pairs.length - both - onlyBefore - onlyAfter,
      mcnemar: mcnemarExact(onlyBefore, onlyAfter),
    };
  });
  const changedUnits = pairs
    .filter(
      ([a, b]) =>
        a.outcome !== b.outcome ||
        a.canonical !== b.canonical ||
        a.autoAcceptedError !== b.autoAcceptedError,
    )
    .map(([a, b]) => ({
      sampleId: a.sampleId,
      repetition: a.repetition,
      before: decisionSummary(a),
      after: decisionSummary(b),
    }));
  return {
    pairedUnits: pairs.length,
    onlyBefore: before.size - pairs.length,
    onlyAfter: after.size - pairs.length,
    metrics,
    changedUnits,
  };
}
