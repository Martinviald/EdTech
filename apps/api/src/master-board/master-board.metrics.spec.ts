import type { PerformanceBandInput } from '@soe/types';
import {
  LEGACY_PERFORMANCE_BANDS,
  addToCellAggregate,
  availableMetrics,
  computeMetrics,
  emptyCellAggregate,
  levelForPercentage,
  resolvePrimaryMetricKey,
  type MetricContext,
} from './master-board.metrics';

const DIA_BANDS: PerformanceBandInput[] = [
  { id: 'b1', key: 'dia_nivel_1', label: 'Nivel I', order: 0, minThreshold: 0, maxThreshold: 0.35 },
  {
    id: 'b2',
    key: 'dia_nivel_2',
    label: 'Nivel II',
    order: 1,
    minThreshold: 0.35,
    maxThreshold: 0.73,
  },
  {
    id: 'b3',
    key: 'dia_nivel_3',
    label: 'Nivel III',
    order: 2,
    minThreshold: 0.73,
    maxThreshold: 1,
  },
];

const legacyContext: MetricContext = { bands: LEGACY_PERFORMANCE_BANDS, sample: null };

describe('master-board.metrics', () => {
  describe('resolvePrimaryMetricKey', () => {
    it('returns achievement for a known key', () => {
      expect(resolvePrimaryMetricKey('achievement', false)).toBe('achievement');
    });

    it('falls back to the default when undefined', () => {
      expect(resolvePrimaryMetricKey(undefined, true)).toBe('achievement');
    });

    it('does not let a user without sample access pick the sample metric', () => {
      expect(resolvePrimaryMetricKey('sample_delta', false)).toBe('achievement');
      expect(resolvePrimaryMetricKey('sample_delta', true)).toBe('sample_delta');
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

  describe('levelForPercentage', () => {
    it('maps a DIA band to its label and projects its position onto a level token', () => {
      expect(levelForPercentage(0.2, DIA_BANDS)).toEqual({
        key: 'dia_nivel_1',
        label: 'Nivel I',
        order: 0,
        color: 'insufficient',
      });
      expect(levelForPercentage(0.5, DIA_BANDS)?.color).toBe('adequate');
      expect(levelForPercentage(1, DIA_BANDS)).toMatchObject({
        key: 'dia_nivel_3',
        color: 'advanced',
      });
    });

    it('returns null without bands', () => {
      expect(levelForPercentage(0.5, null)).toBeNull();
      expect(levelForPercentage(0.5, [])).toBeNull();
    });

    it('keeps the legacy 40/70/85 cut with the legacy bands', () => {
      expect(levelForPercentage(0.39, LEGACY_PERFORMANCE_BANDS)?.key).toBe('insufficient');
      expect(levelForPercentage(0.4, LEGACY_PERFORMANCE_BANDS)?.key).toBe('elementary');
      expect(levelForPercentage(0.7, LEGACY_PERFORMANCE_BANDS)?.key).toBe('adequate');
      expect(levelForPercentage(0.85, LEGACY_PERFORMANCE_BANDS)).toMatchObject({
        key: 'advanced',
        label: 'Avanzado',
        color: 'advanced',
      });
    });
  });

  describe('computeMetrics', () => {
    it('computes achievement as scoreSum/maxSum and derives the band', () => {
      const [metric] = computeMetrics(
        { scoreSum: 42, maxSum: 50, studentsAssessed: 25 },
        legacyContext,
        false,
      );
      expect(metric.key).toBe('achievement');
      expect(metric.value).toBeCloseTo(84);
      expect(metric.display).toBe('84.0%');
      expect(metric.level?.key).toBe('adequate');
    });

    it('returns a null value and dash display when there is no evaluated points', () => {
      const [metric] = computeMetrics(emptyCellAggregate(), legacyContext, false);
      expect(metric.value).toBeNull();
      expect(metric.display).toBe('—');
      expect(metric.level).toBeNull();
    });

    it('shows the number but no level when the cell has no bands', () => {
      const [metric] = computeMetrics(
        { scoreSum: 42, maxSum: 50, studentsAssessed: 25 },
        { bands: null, sample: null },
        false,
      );
      expect(metric.value).toBeCloseTo(84);
      expect(metric.display).toBe('84.0%');
      expect(metric.level).toBeNull();
    });

    it('classifies with the instrument bands', () => {
      const [metric] = computeMetrics(
        { scoreSum: 10, maxSum: 50, studentsAssessed: 25 },
        { bands: DIA_BANDS, sample: null },
        false,
      );
      expect(metric.value).toBeCloseTo(20);
      expect(metric.level).toMatchObject({ key: 'dia_nivel_1', label: 'Nivel I' });
    });
  });

  describe('sample_delta', () => {
    const sampleContext = (deltaPp: number | null): MetricContext => ({
      bands: null,
      sample: deltaPp === null ? null : ({ deltaPp } as MetricContext['sample']),
    });
    const delta = (deltaPp: number | null) =>
      computeMetrics(emptyCellAggregate(), sampleContext(deltaPp), true).find(
        (metric) => metric.key === 'sample_delta',
      );

    it('reads below, similar and above against the ±5 pp similarity band', () => {
      expect(delta(-12.34)).toMatchObject({ value: -12.34, display: '-12.3', tone: 'below' });
      expect(delta(5)).toMatchObject({ display: '+5.0', tone: 'similar' });
      expect(delta(-5)).toMatchObject({ tone: 'similar' });
      expect(delta(5.01)).toMatchObject({ tone: 'above' });
    });

    it('is empty without a sample', () => {
      expect(delta(null)).toMatchObject({ value: null, display: '—', tone: null });
    });

    it('is not computed for a user without sample access', () => {
      const keys = computeMetrics(emptyCellAggregate(), sampleContext(3), false).map((m) => m.key);
      expect(keys).toEqual(['achievement']);
    });
  });

  describe('availableMetrics', () => {
    it('exposes only achievement to a user without sample access', () => {
      expect(availableMetrics(false)).toEqual([{ key: 'achievement', label: '% de logro' }]);
    });

    it('adds the sample delta for a user who can see the sample', () => {
      expect(availableMetrics(true)).toEqual([
        { key: 'achievement', label: '% de logro' },
        { key: 'sample_delta', label: 'Diferencia vs muestra' },
      ]);
    });
  });
});
