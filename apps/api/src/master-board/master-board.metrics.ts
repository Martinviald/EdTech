import {
  DEFAULT_PERFORMANCE_THRESHOLDS,
  METRIC_LABELS,
  METRIC_KEYS,
  percentageToPerformanceLevel,
  type MetricKey,
  type MetricValue,
  type PerformanceLevel,
  type PerformanceThresholds,
} from '@soe/types';

export type CellAggregate = {
  scoreSum: number;
  maxSum: number;
  studentsAssessed: number;
};

export type MetricContext = {
  thresholds: PerformanceThresholds;
  aggregatable: boolean;
};

type MetricComputation = {
  value: number | null;
  display: string;
  level: PerformanceLevel | null;
};

type MetricDescriptor = {
  key: MetricKey;
  label: string;
  compute: (aggregate: CellAggregate, context: MetricContext) => MetricComputation;
};

export function emptyCellAggregate(): CellAggregate {
  return { scoreSum: 0, maxSum: 0, studentsAssessed: 0 };
}

export function addToCellAggregate(target: CellAggregate, source: CellAggregate): void {
  target.scoreSum += source.scoreSum;
  target.maxSum += source.maxSum;
  target.studentsAssessed += source.studentsAssessed;
}

function formatPercentage(value: number | null): string {
  return value === null || Number.isNaN(value) ? '—' : `${value.toFixed(1)}%`;
}

const achievementDescriptor: MetricDescriptor = {
  key: 'achievement',
  label: METRIC_LABELS.achievement,
  compute: (aggregate, context) => {
    const value = aggregate.maxSum > 0 ? (aggregate.scoreSum / aggregate.maxSum) * 100 : null;
    const level =
      value === null || !context.aggregatable
        ? null
        : percentageToPerformanceLevel(value / 100, { performanceThresholds: context.thresholds });
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

export function resolveThresholds(config: unknown): PerformanceThresholds {
  const performanceThresholds = (
    config as { performanceThresholds?: Partial<PerformanceThresholds> } | null | undefined
  )?.performanceThresholds;
  return {
    elementary: performanceThresholds?.elementary ?? DEFAULT_PERFORMANCE_THRESHOLDS.elementary,
    adequate: performanceThresholds?.adequate ?? DEFAULT_PERFORMANCE_THRESHOLDS.adequate,
    advanced: performanceThresholds?.advanced ?? DEFAULT_PERFORMANCE_THRESHOLDS.advanced,
  };
}

export const METRIC_KEY_VALUES = METRIC_KEYS;
