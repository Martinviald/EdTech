import {
  ALERT_THRESHOLDS,
  DEFAULT_PERFORMANCE_THRESHOLDS,
  METRIC_LABELS,
  METRIC_KEYS,
  bandToLegacyLevel,
  classifyByBands,
  type MasterBoardLevel,
  type CellSample,
  type MetricKey,
  type MetricTone,
  type MetricValue,
  type PerformanceBandInput,
  type PerformanceLevel,
} from '@soe/types';

export type CellAggregate = {
  scoreSum: number;
  maxSum: number;
  studentsAssessed: number;
};

export type MetricContext = {
  bands: readonly PerformanceBandInput[] | null;
  sample: CellSample | null;
};

type MetricComputation = {
  value: number | null;
  display: string;
  level: MasterBoardLevel | null;
  tone: MetricTone | null;
};

type MetricDescriptor = {
  key: MetricKey;
  label: string;
  compute: (aggregate: CellAggregate, context: MetricContext) => MetricComputation;
};

const LEGACY_LEVEL_LABELS: Record<PerformanceLevel, string> = {
  insufficient: 'Insuficiente',
  elementary: 'Elemental',
  adequate: 'Adecuado',
  advanced: 'Avanzado',
};

export const LEGACY_PERFORMANCE_BANDS: readonly PerformanceBandInput[] = [
  {
    id: 'insufficient',
    key: 'insufficient',
    label: LEGACY_LEVEL_LABELS.insufficient,
    order: 0,
    minThreshold: 0,
    maxThreshold: DEFAULT_PERFORMANCE_THRESHOLDS.elementary,
  },
  {
    id: 'elementary',
    key: 'elementary',
    label: LEGACY_LEVEL_LABELS.elementary,
    order: 1,
    minThreshold: DEFAULT_PERFORMANCE_THRESHOLDS.elementary,
    maxThreshold: DEFAULT_PERFORMANCE_THRESHOLDS.adequate,
  },
  {
    id: 'adequate',
    key: 'adequate',
    label: LEGACY_LEVEL_LABELS.adequate,
    order: 2,
    minThreshold: DEFAULT_PERFORMANCE_THRESHOLDS.adequate,
    maxThreshold: DEFAULT_PERFORMANCE_THRESHOLDS.advanced,
  },
  {
    id: 'advanced',
    key: 'advanced',
    label: LEGACY_LEVEL_LABELS.advanced,
    order: 3,
    minThreshold: DEFAULT_PERFORMANCE_THRESHOLDS.advanced,
    maxThreshold: 1,
  },
];

export function emptyCellAggregate(): CellAggregate {
  return { scoreSum: 0, maxSum: 0, studentsAssessed: 0 };
}

export function addToCellAggregate(target: CellAggregate, source: CellAggregate): void {
  target.scoreSum += source.scoreSum;
  target.maxSum += source.maxSum;
  target.studentsAssessed += source.studentsAssessed;
}

export function levelForPercentage(
  percentage: number,
  bands: readonly PerformanceBandInput[] | null,
): MasterBoardLevel | null {
  if (!bands || bands.length === 0) return null;
  const band = classifyByBands(percentage, bands);
  if (!band) return null;
  return {
    key: band.key,
    label: band.label,
    order: band.order,
    color: bandToLegacyLevel(band, bands),
  };
}

function formatPercentage(value: number | null): string {
  return value === null || Number.isNaN(value) ? '—' : `${value.toFixed(1)}%`;
}

const achievementDescriptor: MetricDescriptor = {
  key: 'achievement',
  label: METRIC_LABELS.achievement,
  compute: (aggregate, context) => {
    const value = aggregate.maxSum > 0 ? (aggregate.scoreSum / aggregate.maxSum) * 100 : null;
    const level = value === null ? null : levelForPercentage(value / 100, context.bands);
    return { value, display: formatPercentage(value), level, tone: null };
  },
};

export function toneForDelta(deltaPp: number | null): MetricTone | null {
  if (deltaPp === null) return null;
  if (deltaPp < -ALERT_THRESHOLDS.cohort.similarPp) return 'below';
  if (deltaPp > ALERT_THRESHOLDS.cohort.similarPp) return 'above';
  return 'similar';
}

function formatDelta(deltaPp: number | null): string {
  if (deltaPp === null) return '—';
  const rounded = Math.round(deltaPp * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}`;
}

const sampleDeltaDescriptor: MetricDescriptor = {
  key: 'sample_delta',
  label: METRIC_LABELS.sample_delta,
  compute: (_aggregate, context) => {
    const deltaPp = context.sample?.deltaPp ?? null;
    return {
      value: deltaPp,
      display: formatDelta(deltaPp),
      level: null,
      tone: toneForDelta(deltaPp),
    };
  },
};

const METRIC_REGISTRY: readonly MetricDescriptor[] = [achievementDescriptor, sampleDeltaDescriptor];

const SAMPLE_METRIC_KEYS: ReadonlySet<MetricKey> = new Set(['sample_delta']);

const DEFAULT_METRIC_KEY: MetricKey = 'achievement';

function visibleDescriptors(canSeeSample: boolean): readonly MetricDescriptor[] {
  return canSeeSample
    ? METRIC_REGISTRY
    : METRIC_REGISTRY.filter((descriptor) => !SAMPLE_METRIC_KEYS.has(descriptor.key));
}

export function resolvePrimaryMetricKey(
  requested: MetricKey | undefined,
  canSeeSample: boolean,
): MetricKey {
  if (requested && visibleDescriptors(canSeeSample).some((d) => d.key === requested)) {
    return requested;
  }
  return DEFAULT_METRIC_KEY;
}

export function availableMetrics(canSeeSample: boolean): { key: MetricKey; label: string }[] {
  return visibleDescriptors(canSeeSample).map((descriptor) => ({
    key: descriptor.key,
    label: descriptor.label,
  }));
}

export function computeMetrics(
  aggregate: CellAggregate,
  context: MetricContext,
  canSeeSample: boolean,
): MetricValue[] {
  return visibleDescriptors(canSeeSample).map((descriptor) => {
    const { value, display, level, tone } = descriptor.compute(aggregate, context);
    return { key: descriptor.key, label: descriptor.label, value, display, level, tone };
  });
}

export const METRIC_KEY_VALUES = METRIC_KEYS;
