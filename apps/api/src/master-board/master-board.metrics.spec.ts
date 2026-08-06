import {
  addToCellAggregate,
  availableMetrics,
  computeMetrics,
  emptyCellAggregate,
  resolvePrimaryMetricKey,
  resolveThresholds,
  type MetricContext,
} from './master-board.metrics';

const aggregatableContext: MetricContext = {
  thresholds: { elementary: 0.4, adequate: 0.7, advanced: 0.85 },
  aggregatable: true,
};

describe('master-board.metrics', () => {
  describe('resolveThresholds', () => {
    it('falls back to defaults when config is null', () => {
      expect(resolveThresholds(null)).toEqual({ elementary: 0.4, adequate: 0.7, advanced: 0.85 });
    });

    it('reads performanceThresholds from the grading scale config', () => {
      const config = { performanceThresholds: { elementary: 0.5, adequate: 0.75, advanced: 0.9 } };
      expect(resolveThresholds(config)).toEqual({ elementary: 0.5, adequate: 0.75, advanced: 0.9 });
    });

    it('keeps defaults for thresholds missing in config', () => {
      const config = { performanceThresholds: { adequate: 0.72 } };
      expect(resolveThresholds(config)).toEqual({
        elementary: 0.4,
        adequate: 0.72,
        advanced: 0.85,
      });
    });
  });

  describe('resolvePrimaryMetricKey', () => {
    it('returns achievement for a known key', () => {
      expect(resolvePrimaryMetricKey('achievement')).toBe('achievement');
    });

    it('falls back to the default when undefined', () => {
      expect(resolvePrimaryMetricKey(undefined)).toBe('achievement');
    });
  });

  describe('addToCellAggregate', () => {
    it('accumulates score, max and students', () => {
      const target = emptyCellAggregate();
      addToCellAggregate(target, { scoreSum: 30, maxSum: 50, studentsAssessed: 20 });
      addToCellAggregate(target, { scoreSum: 16, maxSum: 20, studentsAssessed: 10 });
      expect(target).toEqual({ scoreSum: 46, maxSum: 70, studentsAssessed: 30 });
    });
  });

  describe('computeMetrics', () => {
    it('computes achievement as scoreSum/maxSum and derives the level', () => {
      const [metric] = computeMetrics(
        { scoreSum: 42, maxSum: 50, studentsAssessed: 25 },
        aggregatableContext,
      );
      expect(metric.key).toBe('achievement');
      expect(metric.value).toBeCloseTo(84);
      expect(metric.display).toBe('84.0%');
      expect(metric.level).toBe('adequate');
    });

    it('returns a null value and dash display when there is no evaluated points', () => {
      const [metric] = computeMetrics(emptyCellAggregate(), aggregatableContext);
      expect(metric.value).toBeNull();
      expect(metric.display).toBe('—');
      expect(metric.level).toBeNull();
    });

    it('shows the number but no level when the scope is not aggregatable', () => {
      const [metric] = computeMetrics(
        { scoreSum: 42, maxSum: 50, studentsAssessed: 25 },
        { ...aggregatableContext, aggregatable: false },
      );
      expect(metric.value).toBeCloseTo(84);
      expect(metric.display).toBe('84.0%');
      expect(metric.level).toBeNull();
    });

    it('classifies a low achievement as insufficient', () => {
      const [metric] = computeMetrics(
        { scoreSum: 10, maxSum: 50, studentsAssessed: 25 },
        aggregatableContext,
      );
      expect(metric.value).toBeCloseTo(20);
      expect(metric.level).toBe('insufficient');
    });
  });

  describe('availableMetrics', () => {
    it('exposes the achievement metric for the selector', () => {
      expect(availableMetrics()).toEqual([{ key: 'achievement', label: '% de logro' }]);
    });
  });
});
