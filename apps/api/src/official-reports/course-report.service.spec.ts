import type { Database } from '@soe/db';
import type { PerformanceBandInput } from '@soe/types';
import { CourseReportService } from './course-report.service';
import type { ReportSupportService } from './report-support.service';
import type { CohortLevelCount } from '../common/helpers/cohort-level-stats.helper';

// Bloque B5 — `buildGeneralResult` es la lógica nueva del informe por curso en modo
// agregado: la Sección 2 (distribución por nivel + "requiere mayor apoyo") se puebla
// desde `assessment_level_stats`. Es un método puro (no toca la BD), así que se prueba
// directo con stubs del `db`/`support`, sin montar toda la secuencia de selects.

const DIA_BANDS: PerformanceBandInput[] = [
  {
    id: 'b1',
    key: 'I',
    label: 'Nivel I',
    order: 1,
    minThreshold: 0,
    maxThreshold: 0.5,
    color: null,
  },
  {
    id: 'b2',
    key: 'II',
    label: 'Nivel II',
    order: 2,
    minThreshold: 0.5,
    maxThreshold: 0.8,
    color: null,
  },
  {
    id: 'b3',
    key: 'III',
    label: 'Nivel III',
    order: 3,
    minThreshold: 0.8,
    maxThreshold: 1,
    color: null,
  },
];

type GeneralResultLike = {
  studentsConsidered: number;
  requiresSupportCount: number;
  requiresSupportPercentage: number | null;
  distribution: { level: string; count: number }[];
};

type BuildGeneralResult = (
  evaluated: unknown[],
  aggregate: { averageAchievement: number | null; studentsAssessed: number } | null,
  levelData: { counts: CohortLevelCount[]; bands: PerformanceBandInput[] } | null,
) => GeneralResultLike;

function makeService(): CourseReportService {
  return new CourseReportService({} as Database, {} as ReportSupportService);
}

function buildGeneralResult(
  svc: CourseReportService,
  ...args: Parameters<BuildGeneralResult>
): GeneralResultLike {
  return (svc as unknown as { buildGeneralResult: BuildGeneralResult }).buildGeneralResult(...args);
}

describe('CourseReportService.buildGeneralResult — informe agregado (Bloque B5)', () => {
  it('agregado con filas de nivel: distribución y "requiere apoyo" desde assessment_level_stats', () => {
    const svc = makeService();
    const res = buildGeneralResult(
      svc,
      [],
      { averageAchievement: 62, studentsAssessed: 4 },
      {
        counts: [
          { performanceBandId: 'b1', count: 3 },
          { performanceBandId: 'b3', count: 1 },
        ],
        bands: DIA_BANDS,
      },
    );

    expect(res.studentsConsidered).toBe(4);
    // "Requiere mayor apoyo" = alumnos en la banda de MENOR order (Nivel I): 3 de 4.
    expect(res.requiresSupportCount).toBe(3);
    expect(res.requiresSupportPercentage).toBeCloseTo(75);
    // Torta legacy vía bandToLegacyLevel: I→insuficiente, III→avanzado.
    const dist = Object.fromEntries(res.distribution.map((b) => [b.level, b.count]));
    expect(dist).toEqual({ insufficient: 3, elementary: 0, adequate: 0, advanced: 1 });
  });

  it('agregado sin filas de nivel: distribución vacía y "requiere apoyo" 0', () => {
    const svc = makeService();
    const res = buildGeneralResult(
      svc,
      [],
      { averageAchievement: 62, studentsAssessed: 4 },
      { counts: [], bands: DIA_BANDS },
    );

    expect(res.requiresSupportCount).toBe(0);
    expect(res.requiresSupportPercentage).toBeNull();
    expect(res.distribution.every((b) => b.count === 0)).toBe(true);
  });

  it('item_level (no agregado): sin regresión, usa el nivel por alumno', () => {
    const svc = makeService();
    const evaluated = [
      {
        studentId: 's1',
        studentRut: '1',
        firstName: 'Ana',
        lastName: 'A',
        percentage: 90,
        grade: null,
        performanceLevel: 'advanced',
      },
      {
        studentId: 's2',
        studentRut: '2',
        firstName: 'Beto',
        lastName: 'B',
        percentage: 20,
        grade: null,
        performanceLevel: 'insufficient',
      },
    ];

    const res = buildGeneralResult(svc, evaluated, null, null);

    expect(res.studentsConsidered).toBe(2);
    // 'insufficient' es REQUIRES_SUPPORT_LEVEL.
    expect(res.requiresSupportCount).toBe(1);
    const dist = Object.fromEntries(res.distribution.map((b) => [b.level, b.count]));
    expect(dist.insufficient).toBe(1);
    expect(dist.advanced).toBe(1);
  });
});
