import type { ResponseFormatKind, ReviewReason } from '@soe/types';
import type {
  EvalDecisionRecord,
  EvalReadingRecord,
  EvalSampleResult,
  EvalSkipReason,
  Overcorrection,
} from './run-sample';

/** Meta de promoción del diseño (§12.2): precisión de lo autoaceptado. */
export const AUTO_ACCEPTED_PRECISION_TARGET = 0.995;

export interface RateMetric {
  readonly count: number;
  readonly total: number;
  readonly rate: number | null;
}

export interface LatencyMetric {
  readonly p50: number | null;
  readonly p95: number | null;
}

export interface ReaderMetrics {
  readonly readerKey: string;
  readonly provider: string;
  readonly model: string;
  readonly promptRef: string;
  readonly role: 'primary' | 'tiebreak';
  readonly readings: number;
  readonly failed: number;
  readonly failuresByStatus: Readonly<Record<string, number>>;
  readonly accuracy: RateMetric;
  readonly accuracyByFormat: Readonly<Partial<Record<ResponseFormatKind, RateMetric>>>;
  readonly overcorrection: RateMetric;
  readonly overcorrectionByKind: Readonly<Record<Overcorrection, number>>;
  readonly stability: RateMetric | null;
  readonly costUsd: number;
  readonly latencyMs: LatencyMetric;
}

export interface FormatDecisionMetrics {
  readonly decisions: number;
  readonly autoAccepted: RateMetric;
  readonly autoAcceptedPrecision: RateMetric;
}

export interface EvalMetrics {
  readonly samples: {
    readonly total: number;
    readonly evaluated: number;
    readonly skipped: Readonly<Partial<Record<EvalSkipReason, number>>>;
  };
  readonly decisions: number;
  readonly readers: readonly ReaderMetrics[];
  readonly autoAccepted: RateMetric;
  readonly autoAcceptedPrecision: RateMetric;
  readonly autoAcceptedErrors: readonly string[];
  readonly review: RateMetric;
  readonly reviewByReason: Readonly<Partial<Record<ReviewReason, RateMetric>>>;
  readonly notRead: RateMetric;
  readonly reviewProposalAccuracy: RateMetric;
  readonly byFormat: Readonly<Partial<Record<ResponseFormatKind, FormatDecisionMetrics>>>;
  readonly agreement: RateMetric;
  readonly correctWhenAgree: RateMetric;
  readonly grading: {
    readonly accuracy: RateMetric;
    readonly autoAcceptedResultError: RateMetric;
  } | null;
  readonly overcorrection: RateMetric;
  readonly cost: {
    readonly totalUsd: number;
    readonly perCropUsd: number | null;
    readonly per1000CropsUsd: number | null;
  };
  readonly latencyMs: LatencyMetric;
  readonly promotion: {
    readonly autoAcceptedPrecisionTarget: number;
    readonly meetsTarget: boolean | null;
  };
}

export function rate(count: number, total: number): RateMetric {
  return { count, total, rate: total === 0 ? null : count / total };
}

/** Percentil por rango más cercano; `null` sin datos. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}

function latency(values: readonly number[]): LatencyMetric {
  return { p50: percentile(values, 50), p95: percentile(values, 95) };
}

function isAutoAccepted(decision: EvalDecisionRecord): boolean {
  return decision.outcome === 'auto_accepted' || decision.outcome === 'auto_blank';
}

function countBy<K extends string>(keys: readonly K[]): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {};
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}

interface ReaderBucket {
  readonly first: EvalReadingRecord;
  readonly readings: EvalReadingRecord[];
  readonly bySample: Map<string, EvalReadingRecord[]>;
  readonly formatOf: Map<string, ResponseFormatKind>;
  readonly answeredTruth: Set<string>;
}

function readerMetrics(bucket: ReaderBucket): ReaderMetrics {
  const { first, readings } = bucket;
  const scored = readings.filter((reading) => reading.transcriptionCorrect !== null);
  const failed = readings.filter((reading) => reading.status !== 'ok');
  const byFormat = new Map<ResponseFormatKind, { count: number; total: number }>();
  for (const [sampleId, sampleReadings] of bucket.bySample) {
    const kind = bucket.formatOf.get(sampleId);
    if (!kind) continue;
    const entry = byFormat.get(kind) ?? { count: 0, total: 0 };
    for (const reading of sampleReadings) {
      if (reading.transcriptionCorrect === null) continue;
      entry.total += 1;
      if (reading.transcriptionCorrect) entry.count += 1;
    }
    byFormat.set(kind, entry);
  }
  const answeredWithTruth = [...bucket.bySample]
    .filter(([sampleId]) => bucket.answeredTruth.has(sampleId))
    .flatMap(([, list]) => list)
    .filter((reading) => reading.state === 'answered');
  const overcorrected = readings.filter((reading) => reading.overcorrection !== null);
  const repeated = [...bucket.bySample.values()].filter((list) => list.length > 1);
  const stable = repeated.filter(
    (list) =>
      new Set(list.map((reading) => `${reading.status}|${reading.state}|${reading.canonical}`))
        .size === 1,
  );
  return {
    readerKey: first.readerKey,
    provider: first.provider,
    model: first.model,
    promptRef: first.promptRef,
    role: first.role,
    readings: readings.length,
    failed: failed.length,
    failuresByStatus: countBy(failed.map((reading) => reading.status)),
    accuracy: rate(scored.filter((reading) => reading.transcriptionCorrect).length, scored.length),
    accuracyByFormat: Object.fromEntries(
      [...byFormat].map(([kind, entry]) => [kind, rate(entry.count, entry.total)]),
    ),
    overcorrection: rate(overcorrected.length, answeredWithTruth.length),
    overcorrectionByKind: {
      equivalent_rewrite: overcorrected.filter((r) => r.overcorrection === 'equivalent_rewrite')
        .length,
      fixed_to_key: overcorrected.filter((r) => r.overcorrection === 'fixed_to_key').length,
    },
    stability: repeated.length === 0 ? null : rate(stable.length, repeated.length),
    costUsd: readings.reduce((total, reading) => total + (reading.costUsd ?? 0), 0),
    latencyMs: latency(failed.length === readings.length ? [] : readings.map((r) => r.latencyMs)),
  };
}

function readerBuckets(samples: readonly EvalSampleResult[]): ReaderBucket[] {
  const buckets = new Map<string, ReaderBucket>();
  for (const sample of samples) {
    for (const reading of sample.readings) {
      const key = `${reading.role}:${reading.readerKey}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          first: reading,
          readings: [],
          bySample: new Map(),
          formatOf: new Map(),
          answeredTruth: new Set(),
        };
        buckets.set(key, bucket);
      }
      bucket.readings.push(reading);
      const list = bucket.bySample.get(sample.id) ?? [];
      list.push(reading);
      bucket.bySample.set(sample.id, list);
      bucket.formatOf.set(sample.id, sample.format.kind);
      if (sample.truth.state === 'answered') bucket.answeredTruth.add(sample.id);
    }
  }
  return [...buckets.values()];
}

function formatMetrics(
  samples: readonly EvalSampleResult[],
): Partial<Record<ResponseFormatKind, FormatDecisionMetrics>> {
  const grouped = new Map<ResponseFormatKind, EvalDecisionRecord[]>();
  for (const sample of samples) {
    const list = grouped.get(sample.format.kind) ?? [];
    list.push(...sample.decisions);
    grouped.set(sample.format.kind, list);
  }
  const result: Partial<Record<ResponseFormatKind, FormatDecisionMetrics>> = {};
  for (const [kind, decisions] of grouped) {
    if (decisions.length === 0) continue;
    const accepted = decisions.filter(isAutoAccepted);
    result[kind] = {
      decisions: decisions.length,
      autoAccepted: rate(accepted.length, decisions.length),
      autoAcceptedPrecision: rate(
        accepted.filter((d) => d.decisionCorrect).length,
        accepted.length,
      ),
    };
  }
  return result;
}

/**
 * Métricas del diseño §12.2 sobre los resultados por muestra. Cada decisión es
 * una muestra × repetición; cada lectura, una llamada a un lector.
 */
export function computeEvalMetrics(samples: readonly EvalSampleResult[]): EvalMetrics {
  const evaluated = samples.filter((sample) => sample.skipped === null);
  const skippedReasons = samples
    .map((sample) => sample.skipped)
    .filter((reason): reason is EvalSkipReason => reason !== null);
  const decisions = evaluated.flatMap((sample) =>
    sample.decisions.map((decision) => ({ sample, decision })),
  );
  const total = decisions.length;
  const accepted = decisions.filter(({ decision }) => isAutoAccepted(decision));
  const acceptedWrong = accepted.filter(({ decision }) => !decision.decisionCorrect);
  const reviewed = decisions.filter(({ decision }) => decision.outcome === 'needs_review');
  const notRead = decisions.filter(({ decision }) => decision.outcome === 'not_read');
  const reasonCounts = countBy(reviewed.flatMap(({ decision }) => decision.reasons));
  const withProposal = reviewed.filter(({ decision }) => decision.valueState !== null);
  const agreementKnown = decisions.filter(({ decision }) => decision.readersAgree !== null);
  const agreed = agreementKnown.filter(({ decision }) => decision.readersAgree === true);
  const graded = decisions.filter(({ decision }) => decision.gradingCorrect !== null);
  const gradedAccepted = graded.filter(({ decision }) => isAutoAccepted(decision));
  const readings = evaluated.flatMap((sample) => sample.readings);
  const answeredReadings = evaluated
    .filter((sample) => sample.truth.state === 'answered')
    .flatMap((sample) => sample.readings)
    .filter((reading) => reading.state === 'answered');
  const totalCost = readings.reduce((sum, reading) => sum + (reading.costUsd ?? 0), 0);
  const precision = rate(accepted.length - acceptedWrong.length, accepted.length);
  const agreedCorrect = agreed.filter(({ sample, decision }) =>
    sample.readings
      .filter((reading) => reading.repetition === decision.repetition && reading.role === 'primary')
      .every((reading) => reading.transcriptionCorrect === true),
  );

  return {
    samples: {
      total: samples.length,
      evaluated: evaluated.length,
      skipped: countBy(skippedReasons),
    },
    decisions: total,
    readers: readerBuckets(evaluated).map(readerMetrics),
    autoAccepted: rate(accepted.length, total),
    autoAcceptedPrecision: precision,
    autoAcceptedErrors: [
      ...new Set(
        acceptedWrong.map(({ sample, decision }) => `${sample.id}#${decision.repetition}`),
      ),
    ],
    review: rate(reviewed.length, total),
    reviewByReason: Object.fromEntries(
      Object.entries(reasonCounts).map(([reason, count]) => [reason, rate(count ?? 0, total)]),
    ),
    notRead: rate(notRead.length, total),
    reviewProposalAccuracy: rate(
      withProposal.filter(({ decision }) => decision.decisionCorrect).length,
      withProposal.length,
    ),
    byFormat: formatMetrics(evaluated),
    agreement: rate(agreed.length, agreementKnown.length),
    correctWhenAgree: rate(agreedCorrect.length, agreed.length),
    grading:
      graded.length === 0
        ? null
        : {
            accuracy: rate(
              graded.filter(({ decision }) => decision.gradingCorrect).length,
              graded.length,
            ),
            autoAcceptedResultError: rate(
              gradedAccepted.filter(({ decision }) => decision.gradingCorrect === false).length,
              gradedAccepted.length,
            ),
          },
    overcorrection: rate(
      answeredReadings.filter((reading) => reading.overcorrection !== null).length,
      answeredReadings.length,
    ),
    cost: {
      totalUsd: totalCost,
      perCropUsd: total === 0 ? null : totalCost / total,
      per1000CropsUsd: total === 0 ? null : (totalCost / total) * 1000,
    },
    latencyMs: latency(readings.filter((r) => r.status === 'ok').map((r) => r.latencyMs)),
    promotion: {
      autoAcceptedPrecisionTarget: AUTO_ACCEPTED_PRECISION_TARGET,
      meetsTarget:
        precision.rate === null ? null : precision.rate >= AUTO_ACCEPTED_PRECISION_TARGET,
    },
  };
}
