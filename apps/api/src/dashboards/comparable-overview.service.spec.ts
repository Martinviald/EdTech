import type { PerformanceBandInput } from '@soe/types';
import type { CohortLevelCount } from '../common/helpers/cohort-level-stats.helper';
import type { BenchmarkSamplesService } from '../benchmarking/benchmark-samples.service';
import type { Database } from '../database/database.types';
import type { ComparableAlertsService } from './comparable-alerts.service';
import { ComparableOverviewService } from './comparable-overview.service';
import {
  ComparableUnitAssembler,
  type AchievementByAssessment,
  type BandClassificationRow,
} from './comparable/comparable-unit.assembler';
import type { DashboardsService } from './dashboards.service';

const BANDS: PerformanceBandInput[] = [
  {
    id: 'b-apoyo',
    key: 'apoyo',
    label: 'Requiere mayor apoyo',
    order: 0,
    minThreshold: 0,
    maxThreshold: 0.7884,
  },
  {
    id: 'b-logrado',
    key: 'logrado',
    label: 'No requiere mayor apoyo',
    order: 1,
    minThreshold: 0.7884,
    maxThreshold: 1,
  },
];

function makeService() {
  return new ComparableOverviewService(
    {} as Database,
    {} as DashboardsService,
    {} as ComparableAlertsService,
    new ComparableUnitAssembler(),
    {} as BenchmarkSamplesService,
  );
}

function buildSummary(
  bands: PerformanceBandInput[],
  achievement: AchievementByAssessment,
  levelCounts: Map<string, CohortLevelCount[]>,
) {
  const service = makeService();
  return service['buildSummary'](
    {
      ref: {
        instrumentId: 'i-lect-7',
        type: 'dia',
        subjectId: 's-lang',
        gradeId: 'g-7',
        applicationPeriod: 'diagnostico',
        year: 2026,
        trackId: null,
      },
      instrumentName: 'DIA Lectura 7° Básico 2026 — Diagnóstico',
      subjectName: 'Lenguaje',
      gradeName: '7° Básico',
      assessmentIds: ['7A', '7B'],
      lastAdministeredAt: null,
    },
    {
      achievementByAssessment: achievement,
      bandsByInstrument: new Map([['i-lect-7', bands]]),
      levelCountsByAssessment: levelCounts,
      classGroupBreakdownByInstrument: new Map(),
      classificationRowsByAssessment: new Map<string, BandClassificationRow[]>(),
    },
  );
}

describe('ComparableOverviewService — severidad por banda del promedio', () => {
  const achievement: AchievementByAssessment = new Map([
    ['7A', { achievement: 85, students: 38 }],
    ['7B', { achievement: 71.4, students: 43 }],
  ]);
  const levelCounts = new Map<string, CohortLevelCount[]>([
    [
      '7A',
      [
        { performanceBandId: 'b-apoyo', count: 8 },
        { performanceBandId: 'b-logrado', count: 30 },
      ],
    ],
    [
      '7B',
      [
        { performanceBandId: 'b-apoyo', count: 32 },
        { performanceBandId: 'b-logrado', count: 11 },
      ],
    ],
  ]);

  it('cada aplicación tiene la severidad de su propio promedio', () => {
    const summary = buildSummary(BANDS, achievement, levelCounts);

    expect(summary.byAssessment).toEqual([
      expect.objectContaining({
        assessmentId: '7A',
        averageAchievement: 85,
        studentsAssessed: 38,
        lowestBandCount: 8,
        severity: 'low',
      }),
      expect.objectContaining({
        assessmentId: '7B',
        averageAchievement: 71.4,
        studentsAssessed: 43,
        lowestBandCount: 32,
        severity: 'high',
      }),
    ]);
    expect(summary.byAssessment[1]!.lowestBandShare).toBeCloseTo(74.42, 1);
  });

  it('la unidad toma la banda de su promedio ponderado, no la concentración de alumnos', () => {
    const summary = buildSummary(BANDS, achievement, levelCounts);

    expect(summary.averageAchievement).toBeCloseTo(77.8, 1);
    expect(summary.severity).toBe('high');
  });

  it('las bandas viajan con sus umbrales para poder explicar el corte', () => {
    const summary = buildSummary(BANDS, achievement, levelCounts);

    expect(summary.bands?.[0]).toMatchObject({ minThreshold: 0, maxThreshold: 0.7884 });
  });

  it('sin bandas no hay severidad ni en la unidad ni en sus aplicaciones', () => {
    const summary = buildSummary([], achievement, levelCounts);

    expect(summary.severity).toBeNull();
    expect(summary.byAssessment.every((entry) => entry.severity === null)).toBe(true);
    expect(summary.byAssessment.every((entry) => entry.lowestBandCount === null)).toBe(true);
  });
});
