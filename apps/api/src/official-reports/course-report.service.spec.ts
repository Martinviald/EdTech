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
  /** Cierre: banda del nivel previo (Monitoreo). Ausente/NULL fuera de Cierre. */
  priorPerformanceBandId?: string | null;
};

type StudentRowLike = {
  studentId: string;
  achievement: number | null;
  performanceLevel: string | null;
  requiresSupport: boolean;
  bandLabel: string | null;
  bandKey: string | null;
  priorBandLabel: string | null;
  priorBandKey: string | null;
};

type BandBucketLike = {
  key: string;
  label: string;
  order: number;
  count: number;
  percentage: number;
};

// Diagnóstico: set de 2 bandas (requiere apoyo / adecuado para el año).
const DIA_DIAG_BANDS: PerformanceBandInput[] = [
  {
    id: 'd1',
    key: 'REQ',
    label: 'Requiere apoyo',
    order: 1,
    minThreshold: 0,
    maxThreshold: 0.5,
    color: null,
  },
  {
    id: 'd2',
    key: 'OK',
    label: 'Adecuado para el año',
    order: 2,
    minThreshold: 0.5,
    maxThreshold: 1,
    color: null,
  },
];

/** Fila por-alumno band-only (informe oficial): banda seteada, sin %. */
function mkBandStudent(studentId: string, performanceBandId: string): EvaluatedLike {
  return {
    studentId,
    studentRut: studentId,
    firstName: studentId,
    lastName: studentId,
    percentage: null,
    grade: null,
    metricType: 'band',
    performanceLevel: null,
    performanceBandId,
  };
}

function buildBandDistributionFromStudents(
  svc: CourseReportService,
  evaluated: EvaluatedLike[],
  bands: PerformanceBandInput[],
): BandBucketLike[] {
  return (
    svc as unknown as {
      buildBandDistributionFromStudents: (
        e: EvaluatedLike[],
        b: PerformanceBandInput[],
      ) => BandBucketLike[];
    }
  ).buildBandDistributionFromStudents(evaluated, bands);
}

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
    // §5 expone el label/key REAL de la banda (para el badge fiel del informe).
    expect(rows[0].bandLabel).toBe('Nivel I');
    expect(rows[0].bandKey).toBe('I');
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
    // Sin banda resuelta → sin label real; la web cae a la etiqueta legacy.
    expect(rows[0].bandLabel).toBeNull();
    expect(rows[0].bandKey).toBeNull();
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
    expect(byId.s1.bandLabel).toBe('Nivel I');
    expect(byId.s2.performanceLevel).toBe('advanced');
    expect(byId.s2.achievement).toBeNull();
    expect(byId.s2.requiresSupport).toBe(false);
    expect(byId.s2.bandLabel).toBe('Nivel III');
  });

  it('(c2) Cierre con nivel previo: expone priorBandLabel/priorBandKey (avance Monitoreo→Cierre)', () => {
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
        performanceBandId: 'b2', // nivel de Cierre: Nivel II
        priorPerformanceBandId: 'b1', // nivel de Monitoreo: Nivel I
      },
    ];

    hydratePerformanceLevels(svc, evaluated, DIA_BANDS);
    const rows = buildStudentResults(svc, evaluated);

    // Banda de Cierre = Nivel II; banda previa (Monitoreo) = Nivel I → avance I → II.
    expect(rows[0].bandLabel).toBe('Nivel II');
    expect(rows[0].bandKey).toBe('II');
    expect(rows[0].priorBandLabel).toBe('Nivel I');
    expect(rows[0].priorBandKey).toBe('I');
    expect(rows[0].achievement).toBeNull();
  });

  it('(c3) sin nivel previo (Monitoreo/Diagnóstico/item_level): priorBand queda NULL, sin regresión', () => {
    const svc = makeService();
    const evaluated: EvaluatedLike[] = [
      // Monitoreo band-only (sin priorPerformanceBandId).
      {
        studentId: 's1',
        studentRut: '1',
        firstName: 'Ana',
        lastName: 'A',
        percentage: null,
        grade: null,
        metricType: 'band',
        performanceLevel: null,
        performanceBandId: 'b3',
      },
      // item_level clasificado por %.
      {
        studentId: 's2',
        studentRut: '2',
        firstName: 'Beto',
        lastName: 'B',
        percentage: 90,
        grade: null,
        metricType: 'percentage',
        performanceLevel: 'advanced',
        performanceBandId: null,
      },
    ];

    hydratePerformanceLevels(svc, evaluated, DIA_BANDS);
    const rows = buildStudentResults(svc, evaluated);

    for (const r of rows) {
      expect(r.priorBandLabel).toBeNull();
      expect(r.priorBandKey).toBeNull();
    }
    // Banda de Cierre intacta (sin regresión).
    const byId = Object.fromEntries(rows.map((r) => [r.studentId, r]));
    expect(byId.s1.bandLabel).toBe('Nivel III');
    expect(byId.s2.bandLabel).toBe('Nivel III');
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
    // 90% cae en la banda superior (Nivel III) por clasificación por umbral.
    expect(rows[0].bandLabel).toBe('Nivel III');
    expect(rows[0].bandKey).toBe('III');
  });
});

// §2 — Distribución por banda del informe fiel: la torta usa las bandas reales del
// instrumento (cantidad + labels), no la escala fija de 4 niveles. En dato granular
// se arma desde las filas por-alumno ya hidratadas.
describe('CourseReportService.buildBandDistributionFromStudents — torta fiel a bandas (§2)', () => {
  it('instrumento con 3 bandas (DIA I/II/III): 3 buckets con labels reales, incl. conteo 0', () => {
    const svc = makeService();
    const evaluated: EvaluatedLike[] = [
      mkBandStudent('s1', 'b1'),
      mkBandStudent('s2', 'b1'),
      mkBandStudent('s3', 'b3'),
    ];
    hydratePerformanceLevels(svc, evaluated, DIA_BANDS);

    const dist = buildBandDistributionFromStudents(svc, evaluated, DIA_BANDS);

    expect(dist.map((b) => b.label)).toEqual(['Nivel I', 'Nivel II', 'Nivel III']);
    const byKey = Object.fromEntries(dist.map((b) => [b.key, b.count]));
    // I: 2 alumnos, II: 0 (banda vacía presente), III: 1.
    expect(byKey).toEqual({ I: 2, II: 0, III: 1 });
    const nivelI = dist.find((b) => b.key === 'I')!;
    expect(nivelI.percentage).toBeCloseTo((2 / 3) * 100);
  });

  it('instrumento con 2 bandas (Diagnóstico): 2 buckets con labels reales', () => {
    const svc = makeService();
    const evaluated: EvaluatedLike[] = [
      mkBandStudent('s1', 'd1'),
      mkBandStudent('s2', 'd2'),
      mkBandStudent('s3', 'd2'),
    ];
    hydratePerformanceLevels(svc, evaluated, DIA_DIAG_BANDS);

    const dist = buildBandDistributionFromStudents(svc, evaluated, DIA_DIAG_BANDS);

    expect(dist).toHaveLength(2);
    expect(dist.map((b) => b.label)).toEqual(['Requiere apoyo', 'Adecuado para el año']);
    const byKey = Object.fromEntries(dist.map((b) => [b.key, b.count]));
    expect(byKey).toEqual({ REQ: 1, OK: 2 });
  });
});
