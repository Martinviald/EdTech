import {
  DEFAULT_PERFORMANCE_THRESHOLDS,
  METRIC_LABELS,
  METRIC_KEYS,
  bandToLegacyLevel,
  classifyByBands,
  type MasterBoardLevel,
  type MetricKey,
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
};

type MetricComputation = {
  value: number | null;
  display: string;
  level: MasterBoardLevel | null;
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
    return { value, display: formatPercentage(value), level };
  },
};

const METRIC_REGISTRY: readonly MetricDescriptor[] = [achievementDescriptor];

const DEFAULT_METRIC_KEY: MetricKey = 'achievement';

export function resolvePrimaryMetricKey(requested: MetricKey | undefined): MetricKey {
  if (requested && METRIC_REGISTRY.some((descriptor) => descriptor.key === requested)) {
    return requested;
  }
  return DEFAULT_METRIC_KEY;
}

export function availableMetrics(): { key: MetricKey; label: string }[] {
  return METRIC_REGISTRY.map((descriptor) => ({ key: descriptor.key, label: descriptor.label }));
}

export function computeMetrics(aggregate: CellAggregate, context: MetricContext): MetricValue[] {
  return METRIC_REGISTRY.map((descriptor) => {
    const { value, display, level } = descriptor.compute(aggregate, context);
    return { key: descriptor.key, label: descriptor.label, value, display, level };
  });
}

export const METRIC_KEY_VALUES = METRIC_KEYS;
