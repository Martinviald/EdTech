import type { Database } from '@soe/db';
import type {
  EstablishmentSubjectSection,
  MetricType,
  PerformanceBandInput,
  PerformanceLevel,
} from '@soe/types';
import { EstablishmentReportService } from './establishment-report.service';
import type { ReportSupportService } from './report-support.service';

const DIA_BANDS: PerformanceBandInput[] = [
  { id: 'b1', key: 'dia_nivel_1', label: 'Nivel I', order: 0, minThreshold: 0, maxThreshold: 0.3 },
  {
    id: 'b2',
    key: 'dia_nivel_2',
    label: 'Nivel II',
    order: 1,
    minThreshold: 0.3,
    maxThreshold: 0.75,
  },
  {
    id: 'b3',
    key: 'dia_nivel_3',
    label: 'Nivel III',
    order: 2,
    minThreshold: 0.75,
    maxThreshold: 1,
  },
];

const OTHER_BANDS: PerformanceBandInput[] = [
  { id: 'o1', key: 'low', label: 'Bajo', order: 0, minThreshold: 0, maxThreshold: 0.5 },
  { id: 'o2', key: 'high', label: 'Alto', order: 1, minThreshold: 0.5, maxThreshold: 1 },
];

type RawRowLike = {
  studentId: string;
  gender: string | null;
  percentage: number | null;
  performanceLevel: PerformanceLevel | null;
  metricType: MetricType;
  performanceBandId: string | null;
  band: PerformanceBandInput | null;
  subjectId: string;
  subjectName: string;
  gradeId: string;
  gradeName: string;
  gradeOrder: number;
  instrumentId: string;
};

type ServiceInternals = {
  hydrateBands(rows: RawRowLike[], bands: Map<string, PerformanceBandInput[]>): void;
  aggregate(
    rows: RawRowLike[],
    bands: Map<string, PerformanceBandInput[]>,
  ): EstablishmentSubjectSection[];
};

function internals(): ServiceInternals {
  return new EstablishmentReportService(
    {} as Database,
    {} as ReportSupportService,
  ) as unknown as ServiceInternals;
}

function legacyLevelOf(percentage: number): PerformanceLevel {
  if (percentage < 50) return 'insufficient';
  if (percentage < 70) return 'elementary';
  if (percentage < 85) return 'adequate';
  return 'advanced';
}

function row(index: number, percentage: number, overrides: Partial<RawRowLike> = {}): RawRowLike {
  return {
    studentId: `s${index}`,
    gender: null,
    percentage,
    performanceLevel: legacyLevelOf(percentage),
    metricType: 'percentage',
    performanceBandId: null,
    band: null,
    subjectId: 'lang',
    subjectName: 'Lenguaje y Comunicación',
    gradeId: 'g6',
    gradeName: '6° Básico',
    gradeOrder: 6,
    instrumentId: 'lectura-6',
    ...overrides,
  };
}

const LECTURA_6_PERCENTAGES = [
  50, 53.33, 53.33, 63.33, 66.67, 66.67, 70, 73.33, 73.33, 76.67, 76.67, 76.67, 80, 83.33, 86.67,
  90, 93.33, 93.33,
];

function run(rows: RawRowLike[], bands: Map<string, PerformanceBandInput[]>) {
  const svc = internals();
  svc.hydrateBands(rows, bands);
  return svc.aggregate(rows, bands);
}

describe('EstablishmentReportService — distribución por banda del instrumento', () => {
  it('clasifica por los cortes del instrumento y coincide con el informe por evaluación', () => {
    const rows = LECTURA_6_PERCENTAGES.map((p, i) => row(i, p));
    const [section] = run(rows, new Map([['lectura-6', DIA_BANDS]]));

    expect(section!.bands?.map((b) => b.key)).toEqual([
      'dia_nivel_1',
      'dia_nivel_2',
      'dia_nivel_3',
    ]);
    const byBand = new Map(section!.bandDistribution!.map((c) => [c.bandKey, c]));
    expect(byBand.get('dia_nivel_1')).toMatchObject({ count: 0, total: 18, percentage: 0 });
    expect(byBand.get('dia_nivel_2')).toMatchObject({ count: 9, total: 18, percentage: 50 });
    expect(byBand.get('dia_nivel_3')).toMatchObject({ count: 9, total: 18, percentage: 50 });
  });

  it('usa la banda guardada en filas band-only sin porcentaje', () => {
    const rows = [
      row(1, 0, {
        percentage: null,
        performanceLevel: null,
        metricType: 'band',
        performanceBandId: 'b1',
      }),
      row(2, 0, {
        percentage: null,
        performanceLevel: null,
        metricType: 'band',
        performanceBandId: 'b3',
      }),
    ];
    const [section] = run(rows, new Map([['lectura-6', DIA_BANDS]]));

    const byBand = new Map(section!.bandDistribution!.map((c) => [c.bandKey, c.count]));
    expect(byBand.get('dia_nivel_1')).toBe(1);
    expect(byBand.get('dia_nivel_3')).toBe(1);
  });

  it('cae a los niveles legacy si algún instrumento de la asignatura no tiene bandas', () => {
    const rows = [
      row(1, 60),
      row(2, 90, { gradeId: 'g7', gradeOrder: 7, instrumentId: 'lectura-7' }),
    ];
    const [section] = run(rows, new Map([['lectura-6', DIA_BANDS]]));

    expect(section!.bands).toBeUndefined();
    expect(section!.bandDistribution).toBeUndefined();
    expect(section!.levelDistribution.length).toBeGreaterThan(0);
  });

  it('cae a los niveles legacy si los instrumentos tienen sets de bandas distintos', () => {
    const rows = [row(1, 60), row(2, 90, { gradeId: 'g7', gradeOrder: 7, instrumentId: 'otro-7' })];
    const [section] = run(
      rows,
      new Map([
        ['lectura-6', DIA_BANDS],
        ['otro-7', OTHER_BANDS],
      ]),
    );

    expect(section!.bands).toBeUndefined();
  });
});
