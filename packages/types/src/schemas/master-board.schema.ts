import { z } from 'zod';
import type { InstrumentType, PerformanceLevel } from '../enums';
import type { ComparabilityMeta } from '../comparability';
import type { ProcessKind } from './measurement-process.schema';
import { uuidCsvSchema } from './common.schema';
import type { TypicalZone } from './benchmark.schema';
import {
  INSTRUMENT_APPLICATION_PERIODS,
  type InstrumentApplicationPeriod,
} from './instrument.schema';

// ─────────────────────────────────────────────────────────────────────────────
// Tablero Maestro — matriz Asignaturas (columnas) × Cursos agrupados por Nivel
// (filas), de % de logro por celda, para una "toma" de evaluaciones.
// Módulo backend: apps/api/src/master-board/  (ruta base /api/master-board)
// Ver docs/Diseño Tablero Maestro.md.
// ─────────────────────────────────────────────────────────────────────────────

// ── Métricas extensibles (§4.7 del diseño) ───────────────────────────────────
// La celda NO lleva un `achievement` fijo: lleva `metrics: MetricValue[]` derivadas
// de un `CellAggregate` crudo por un registro de descriptores en el backend. Agregar
// una métrica = un valor más acá + su descriptor en `master-board.metrics.ts`; ni el
// pipeline de agregación ni la tabla del frontend cambian.

/**
 * Métricas disponibles para colorear/ordenar la matriz.
 *  · `achievement`: % de logro (Σ puntaje ÷ Σ máximo), coloreado por la banda del instrumento.
 *  · `sample_delta`: diferencia en pp contra la muestra de colegios, coloreada por su `tone`.
 *    Sólo se ofrece a quien puede ver la muestra (docs/diseno-logro-unificado-y-cohorte.md §5.2).
 */
export const METRIC_KEYS = ['achievement', 'sample_delta'] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/** Etiqueta de cada métrica para el selector y los tooltips. */
export const METRIC_LABELS: Record<MetricKey, string> = {
  achievement: '% de logro',
  sample_delta: 'Diferencia vs muestra',
};

/**
 * Lectura de una diferencia contra la muestra: bajo, similar o sobre. "Similar" es
 * |Δ| ≤ `ALERT_THRESHOLDS.cohort.similarPp`.
 */
export const METRIC_TONES = ['below', 'similar', 'above'] as const;
export type MetricTone = (typeof METRIC_TONES)[number];

/**
 * Nivel de desempeño genérico de una celda: la banda (`performance_bands`) del instrumento
 * en que cae el valor. `color` es la clave del token visual (`--level-<color>`): la posición
 * relativa de la banda dentro de su set, proyectada a los cuatro tokens de nivel.
 */
export type MasterBoardLevel = {
  key: string;
  label: string;
  order: number;
  color: PerformanceLevel;
};

/** Valor ya calculado de una métrica para una celda. */
export type MetricValue = {
  key: MetricKey;
  label: string;
  /** Valor numérico crudo (para ordenar); `null` si la celda no tiene datos. */
  value: number | null;
  /** Valor formateado listo para pintar (ej. "72.4%", "—"). */
  display: string;
  /** Banda de desempeño para el color de la celda, o `null` si la celda no colorea por nivel. */
  level: MasterBoardLevel | null;
  /** Tono de una métrica de diferencia (`sample_delta`); `null` en las demás o sin dato. */
  tone: MetricTone | null;
};

/**
 * Contraste de una celda contra la muestra de colegios
 * (docs/diseno-logro-unificado-y-cohorte.md §5.1–5.2).
 *
 * La muestra se calcula SÓLO sobre las preguntas que la celda tiene corregidas (D9):
 * `comparedItems` de `totalItems`. `percentile` y `typicalZone` van sólo en celdas de nivel
 * de un usuario con alcance completo; en celdas de curso son `null` (D2).
 */
export type CellSample = {
  /** Instrumento de la celda (para enlazar a la comparación completa). */
  instrumentId: string;
  /** "Muestra" (pool global). */
  label: string;
  /** % de logro de la muestra sobre las preguntas comparadas. */
  value: number | null;
  /** % de la celda sobre esas mismas preguntas. */
  cellValue: number | null;
  /** cellValue − value, en pp. */
  deltaPp: number | null;
  schoolCount: number;
  studentCount: number;
  comparedItems: number;
  totalItems: number;
  percentile: number | null;
  typicalZone: TypicalZone | null;
  refreshedAt: string;
};

// ── Query DTOs ───────────────────────────────────────────────────────────────

/**
 * Filtro del tablero. Una "toma" se resuelve por UNO de:
 *  - proceso de medición: `processId` (tiene precedencia y no se combina con los demás), o
 *  - toma legacy: `academicYearId` + `instrumentType` (+ `applicationPeriod` opcional),
 *    solo con las evaluaciones que no están en un proceso, o
 *  - selección libre: `assessmentId[]`.
 * `gradeId`/`subjectId` recortan la matriz. `metric` elige la métrica primaria.
 */
export const MASTER_BOARD_LEGACY_TAKE_PARAMS = [
  'academicYearId',
  'instrumentType',
  'applicationPeriod',
  'assessmentId',
] as const;

export const masterBoardMatrixQuerySchema = z
  .object({
    processId: z.string().uuid().optional(),
    academicYearId: z.string().uuid().optional(),
    instrumentType: z.string().optional(),
    applicationPeriod: z.enum(INSTRUMENT_APPLICATION_PERIODS).optional(),
    assessmentId: uuidCsvSchema,
    gradeId: uuidCsvSchema,
    subjectId: uuidCsvSchema,
    metric: z.enum(METRIC_KEYS).optional(),
  })
  .strict()
  .superRefine((query, ctx) => {
    if (!query.processId) return;
    for (const param of MASTER_BOARD_LEGACY_TAKE_PARAMS) {
      if (query[param] === undefined) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [param],
        message: 'no se puede combinar con processId: la toma ya la define el proceso',
      });
    }
  });
export type MasterBoardMatrixQueryDto = z.infer<typeof masterBoardMatrixQuerySchema>;

/** Query del catálogo de tomas. Sin params: devuelve las tomas visibles del scope. */
export const masterBoardTakesQuerySchema = z
  .object({
    academicYearId: z.string().uuid().optional(),
  })
  .strict();
export type MasterBoardTakesQueryDto = z.infer<typeof masterBoardTakesQuerySchema>;

/** Query del desempeño de un profesor. */
export const teacherPerformanceQuerySchema = z.object({
  academicYearId: z.string().uuid().optional(),
});
export type TeacherPerformanceQueryDto = z.infer<typeof teacherPerformanceQuerySchema>;

// ── Tomas (para el selector) ─────────────────────────────────────────────────

/**
 * Una "toma" de evaluaciones seleccionable en el tablero.
 *
 * - Toma de proceso: `key = "process:<processId>"`. Aparece aunque aún no tenga resultados.
 * - Toma legacy: `key = "legacy:<yearId>:<type>:<period|_>"`, solo con las evaluaciones que
 *   no están en un proceso vigente. Su etiqueta termina en "· sin proceso".
 *
 * El arreglo viene ordenado por fecha de aplicación, la más reciente primero: la primera
 * toma es la toma por defecto.
 */
export type MasterBoardTake = {
  key: string;
  /** Etiqueta lista para la UI, ej. "Ensayo PAES 3 2026" o "DIA Monitoreo 2025 · sin proceso". */
  label: string;
  academicYearId: string;
  /** Proceso de medición de la toma, o `null` en una toma legacy. */
  processId: string | null;
  processKind: ProcessKind | null;
  /** Tipo de instrumento; `null` si el proceso mezcla tipos o aún no tiene evaluaciones. */
  instrumentType: InstrumentType | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  /** Ventana de aplicación (YYYY-MM-DD). En un proceso cae a `starts_on`/`ends_on`. */
  administeredFrom: string | null;
  administeredTo: string | null;
  /** Nº de evaluaciones con resultados en el alcance. */
  assessmentCount: number;
  /** Nº de evaluaciones vinculadas al proceso en el alcance (= `assessmentCount` en legacy). */
  linkedAssessmentCount: number;
  /** `false` si el proceso todavía no tiene resultados. */
  hasResults: boolean;
  /**
   * El proceso tiene evaluaciones hermanas sin vincular: del mismo año, tipo y período, y
   * que entrarían sin romper la invariante del proceso (un instrumento por nivel y prueba).
   */
  partial: boolean;
};

export type MasterBoardAcademicYear = {
  id: string;
  year: number;
  label: string;
  isCurrent: boolean;
};

/** GET /api/master-board/takes → catálogo para poblar el selector de toma. */
export type MasterBoardTakesResponse = {
  takes: MasterBoardTake[];
  academicYears: MasterBoardAcademicYear[];
};

// ── Matriz ───────────────────────────────────────────────────────────────────

/**
 * De dónde sale la columna de una prueba:
 *  - `subject`: la asignatura completa (sin línea de prueba).
 *  - `instrument`: la línea del instrumento (M1, M2).
 *  - `section`: una parte de un instrumento con secciones electivas (Común, Bio, Fís, Quí).
 *    Sus celdas no tienen niveles propios.
 */
export const MASTER_BOARD_TEST_SOURCES = ['subject', 'instrument', 'section'] as const;
export type MasterBoardTestSource = (typeof MASTER_BOARD_TEST_SOURCES)[number];

/**
 * Una prueba = una columna de la matriz, dentro de una asignatura. `testKey` es
 * `track:<trackId>` o `subject:<subjectId>`, estable entre tomas.
 */
export type MasterBoardTest = {
  testKey: string;
  trackId: string | null;
  source: MasterBoardTestSource;
  name: string;
  shortName: string;
  order: number;
  /** Alguna celda de nivel de la columna tiene bandas propias. */
  hasLevels: boolean;
  /** Alguna celda de nivel de la columna mezcla instrumentos sin línea. */
  mixed: boolean;
};

/**
 * Una asignatura agrupa sus pruebas (encabezado de dos niveles). Una asignatura sin
 * líneas trae un solo test, con la clave de la asignatura. Con más de una prueba no hay
 * total de asignatura.
 */
export type MasterBoardSubject = {
  subjectId: string;
  name: string;
  shortName: string;
  tests: MasterBoardTest[];
};

/** Celda a nivel de NIVEL × prueba (agregado de los cursos del nivel). */
export type MasterBoardCell = {
  subjectId: string;
  testKey: string;
  studentsAssessed: number;
  /** Métricas calculadas; se colorea por la que matchea `primaryMetricKey`. */
  metrics: MetricValue[];
  /** Más de un instrumento distinto sin línea: no se colorea por nivel. */
  mixed: boolean;
  /** La celda se colorea con las bandas de su único instrumento. */
  hasLevels: boolean;
  comparability: ComparabilityMeta;
  /** Contraste con la muestra; `null` si no aplica (rol, vista docente, mixta, bajo k). */
  sample: CellSample | null;
};

/** Celda a nivel de CURSO × prueba (destino de click + tooltip de profesor). */
export type MasterBoardCourseCell = {
  subjectId: string;
  testKey: string;
  studentsAssessed: number;
  metrics: MetricValue[];
  mixed: boolean;
  hasLevels: boolean;
  comparability: ComparabilityMeta;
  sample: CellSample | null;
  /** Profesor `primary` de esa asignatura en ese curso, o `null` si no hay asignación. */
  teacher: MasterBoardTeacherRef | null;
  /**
   * 1 → detalle directo; >1 → desambiguar (recuperativo, formas: `studentsAssessed` es el
   * máximo por ítem y puede subcontar); 0 → sin evaluación.
   */
  assessmentIds: string[];
};

export type MasterBoardTeacherRef = {
  userId: string;
  name: string;
};

/** Un curso = una fila hija (expandible) dentro de un nivel. */
export type MasterBoardCourse = {
  classGroupId: string;
  name: string;
  cells: MasterBoardCourseCell[];
};

/** Un nivel = una fila de la matriz, expandible a sus cursos. */
export type MasterBoardGrade = {
  gradeId: string;
  name: string;
  order: number;
  cells: MasterBoardCell[];
  courses: MasterBoardCourse[];
};

/** Toma resuelta que echó la matriz (eco del filtro). */
export type MasterBoardResolvedTake = {
  label: string;
  processId: string | null;
  processKind: ProcessKind | null;
  academicYearId: string | null;
  instrumentType: InstrumentType | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  assessmentIds: string[];
};

/** GET /api/master-board/matrix → matriz asignatura × (nivel→curso). */
export type MasterBoardMatrix = {
  take: MasterBoardResolvedTake;
  primaryMetricKey: MetricKey;
  availableMetrics: { key: MetricKey; label: string }[];
  subjects: MasterBoardSubject[];
  grades: MasterBoardGrade[];
  /** Comparabilidad de toda la toma. La de cada celda viene en la celda. */
  comparability: ComparabilityMeta;
  /**
   * Una URL legacy cuyas evaluaciones están TODAS en un mismo proceso: la toma legacy ya
   * no existe y la UI debe redirigir a `?processId=<redirectProcessId>`.
   */
  redirectProcessId: string | null;
};

// ── Desempeño de un profesor ─────────────────────────────────────────────────

export type TeacherPerformanceSubject = {
  subjectId: string;
  subjectName: string;
  role: 'primary' | 'assistant';
  metrics: MetricValue[];
  studentsAssessed: number;
  assessmentIds: string[];
};

export type TeacherPerformanceClass = {
  classGroupId: string;
  className: string;
  gradeName: string;
  gradeOrder: number;
  subjects: TeacherPerformanceSubject[];
};

/** GET /api/master-board/teachers/:userId/performance */
export type TeacherPerformance = {
  teacher: { userId: string; name: string; email: string };
  academicYearId: string | null;
  primaryMetricKey: MetricKey;
  classes: TeacherPerformanceClass[];
};
