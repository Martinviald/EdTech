import type { Database } from '@soe/db';
import type { MetricType, PerformanceBandInput } from '@soe/types';
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

type EvaluatedLike = {
  studentId: string;
  studentRut: string;
  firstName: string;
  lastName: string;
  percentage: number | null;
  grade: number | null;
  metricType: MetricType;
  performanceLevel: string | null;
  performanceBandId: string | null;
};

type StudentRowLike = {
  studentId: string;
  achievement: number | null;
  performanceLevel: string | null;
  requiresSupport: boolean;
};

function hydratePerformanceLevels(
  svc: CourseReportService,
  evaluated: EvaluatedLike[],
  bands: PerformanceBandInput[],
): void {
  (
    svc as unknown as {
      hydratePerformanceLevels: (e: EvaluatedLike[], b: PerformanceBandInput[]) => void;
    }
  ).hydratePerformanceLevels(evaluated, bands);
}

function buildStudentResults(
  svc: CourseReportService,
  evaluated: EvaluatedLike[],
): StudentRowLike[] {
  return (
    svc as unknown as {
      buildStudentResults: (
        e: EvaluatedLike[],
        cg: Map<string, { id: string; name: string }>,
      ) => StudentRowLike[];
    }
  ).buildStudentResults(evaluated, new Map());
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

// §5 — Resultados por estudiante. La hidratación es band-autoritativa por
// `metricType`: las filas `metric_type='band'` (informe oficial) derivan el nivel de
// la banda guardada IGNORANDO `percentage`; el resto (item_level) clasifica por %.
//
// - Monitoreo/Cierre band-only: `percentage` NULL, banda seteada → nivel desde banda.
// - Diagnóstico: NO usa niveles I/II/III sino binario "requiere apoyo" + una posición
//   `scorePct` APROXIMADA. La banda importada (Nivel I cuando requiere apoyo, o ninguna)
//   manda sobre el % aproximado. `percentage` guarda esa posición sólo para mostrarla.
describe('CourseReportService §5 — nómina + nivel por estudiante', () => {
  it('(a) Diagnóstico requiere-apoyo: banda Nivel I manda sobre el % aproximado; muestra la posición', () => {
    const svc = makeService();
    const evaluated: EvaluatedLike[] = [
      {
        studentId: 's1',
        studentRut: '1',
        firstName: 'Ana',
        lastName: 'A',
        // scorePct=90 (posición aprox., alto) pero la banda dice Nivel I: la banda manda.
        percentage: 90,
        grade: null,
        metricType: 'band',
        performanceLevel: null,
        performanceBandId: 'b1', // Nivel I → "requiere mayor apoyo"
      },
    ];

    hydratePerformanceLevels(svc, evaluated, DIA_BANDS);
    const rows = buildStudentResults(svc, evaluated);

    // El nivel sale de la banda (I → insufficient = REQUIRES_SUPPORT_LEVEL), NO del 90%.
    expect(rows[0].performanceLevel).toBe('insufficient');
    expect(rows[0].requiresSupport).toBe(true);
    // El % se conserva como posición aproximada para mostrar (no se re-clasifica).
    expect(rows[0].achievement).toBe(90);
  });

  it('(b) Diagnóstico sin banda (no requiere apoyo): nivel no determinado; muestra la posición', () => {
    const svc = makeService();
    const evaluated: EvaluatedLike[] = [
      {
        studentId: 's1',
        studentRut: '1',
        firstName: 'Ana',
        lastName: 'A',
        // scorePct bajo pero NO requiere apoyo (sin banda): el % no re-clasifica el nivel.
        percentage: 20,
        grade: null,
        metricType: 'band',
        performanceLevel: null,
        performanceBandId: null,
      },
    ];

    hydratePerformanceLevels(svc, evaluated, DIA_BANDS);
    const rows = buildStudentResults(svc, evaluated);

    expect(rows[0].performanceLevel).toBeNull();
    expect(rows[0].requiresSupport).toBe(false);
    expect(rows[0].achievement).toBe(20);
  });

  it('(c) Monitoreo band-only (percentage NULL): deriva el nivel desde la banda, sin regresión', () => {
    const svc = makeService();
    const evaluated: EvaluatedLike[] = [
      {
        studentId: 's1',
        studentRut: '1',
        firstName: 'Ana',
        lastName: 'A',
        percentage: null,
        grade: null,
        metricType: 'band',
        performanceLevel: null,
        performanceBandId: 'b1', // banda de menor order → requiere apoyo
      },
      {
        studentId: 's2',
        studentRut: '2',
        firstName: 'Beto',
        lastName: 'B',
        percentage: null,
        grade: null,
        metricType: 'band',
        performanceLevel: null,
        performanceBandId: 'b3',
      },
    ];

    hydratePerformanceLevels(svc, evaluated, DIA_BANDS);
    const rows = buildStudentResults(svc, evaluated);

    expect(rows).toHaveLength(2);
    const byId = Object.fromEntries(rows.map((r) => [r.studentId, r]));
    // I → insufficient (REQUIRES_SUPPORT_LEVEL); III → advanced. Sin % en ninguno.
    expect(byId.s1.performanceLevel).toBe('insufficient');
    expect(byId.s1.achievement).toBeNull();
    expect(byId.s1.requiresSupport).toBe(true);
    expect(byId.s2.performanceLevel).toBe('advanced');
    expect(byId.s2.achievement).toBeNull();
    expect(byId.s2.requiresSupport).toBe(false);
  });

  it('agregado sin filas: studentResults vacío', () => {
    const svc = makeService();
    const evaluated: EvaluatedLike[] = [];
    hydratePerformanceLevels(svc, evaluated, DIA_BANDS);
    expect(buildStudentResults(svc, evaluated)).toEqual([]);
  });

  it('(d) item_level (metric_type percentage): clasifica por %, no re-deriva el nivel', () => {
    const svc = makeService();
    const evaluated: EvaluatedLike[] = [
      {
        studentId: 's1',
        studentRut: '1',
        firstName: 'Ana',
        lastName: 'A',
        percentage: 90,
        grade: null,
        metricType: 'percentage',
        performanceLevel: 'advanced',
        performanceBandId: null,
      },
    ];

    hydratePerformanceLevels(svc, evaluated, DIA_BANDS);
    const rows = buildStudentResults(svc, evaluated);

    expect(rows[0].achievement).toBe(90);
    expect(rows[0].performanceLevel).toBe('advanced');
  });
});
