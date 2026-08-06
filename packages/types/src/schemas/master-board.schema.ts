import { z } from 'zod';
import type { InstrumentType, PerformanceLevel } from '../enums';
import type { ComparabilityMeta } from '../comparability';
import { uuidCsvSchema } from './common.schema';
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

/** Métricas disponibles para colorear/ordenar la matriz. 1ª entrega: solo `achievement`. */
export const METRIC_KEYS = ['achievement'] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/** Etiqueta de cada métrica para el selector y los tooltips. */
export const METRIC_LABELS: Record<MetricKey, string> = {
  achievement: '% de logro',
};

/** Valor ya calculado de una métrica para una celda. */
export type MetricValue = {
  key: MetricKey;
  label: string;
  /** Valor numérico crudo (para ordenar); `null` si la celda no tiene datos. */
  value: number | null;
  /** Valor formateado listo para pintar (ej. "72.4%", "—"). */
  display: string;
  /** Nivel de desempeño para el color de la celda, o `null` si la métrica no colorea por nivel. */
  level: PerformanceLevel | null;
};

// ── Query DTOs ───────────────────────────────────────────────────────────────

/**
 * Filtro del tablero. Una "toma" se resuelve por CUALQUIERA de:
 *  - toma derivada: `academicYearId` + `instrumentType` (+ `applicationPeriod` opcional), o
 *  - selección libre: `assessmentId[]`.
 * `gradeId`/`subjectId` recortan la matriz. `metric` elige la métrica primaria.
 */
export const masterBoardMatrixQuerySchema = z.object({
  academicYearId: z.string().uuid().optional(),
  instrumentType: z.string().optional(),
  applicationPeriod: z.enum(INSTRUMENT_APPLICATION_PERIODS).optional(),
  assessmentId: uuidCsvSchema,
  gradeId: uuidCsvSchema,
  subjectId: uuidCsvSchema,
  metric: z.enum(METRIC_KEYS).optional(),
});
export type MasterBoardMatrixQueryDto = z.infer<typeof masterBoardMatrixQuerySchema>;

/** Query del catálogo de tomas. Sin params: devuelve las tomas visibles del scope. */
export const masterBoardTakesQuerySchema = z.object({
  academicYearId: z.string().uuid().optional(),
});
export type MasterBoardTakesQueryDto = z.infer<typeof masterBoardTakesQuerySchema>;

/** Query del desempeño de un profesor. */
export const teacherPerformanceQuerySchema = z.object({
  academicYearId: z.string().uuid().optional(),
});
export type TeacherPerformanceQueryDto = z.infer<typeof teacherPerformanceQuerySchema>;

// ── Tomas (para el selector) ─────────────────────────────────────────────────

/** Una "toma" de evaluaciones seleccionable en el tablero. */
export type MasterBoardTake = {
  /** Clave estable para la URL: `"{yearId}:{type}:{period|_}"` (derivada). */
  key: string;
  /** Etiqueta lista para la UI, ej. "DIA Monitoreo 2025". */
  label: string;
  academicYearId: string;
  instrumentType: InstrumentType;
  applicationPeriod: InstrumentApplicationPeriod | null;
  /** Nº de evaluaciones que componen la toma (con datos en el scope). */
  assessmentCount: number;
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

/** Una asignatura = una columna de la matriz. */
export type MasterBoardSubject = {
  subjectId: string;
  name: string;
  shortName: string;
};

/** Celda a nivel de NIVEL (agregado ponderado de los cursos del nivel). */
export type MasterBoardCell = {
  subjectId: string;
  studentsAssessed: number;
  /** Métricas calculadas; se colorea por la que matchea `primaryMetricKey`. */
  metrics: MetricValue[];
};

/** Celda a nivel de CURSO (destino de click + tooltip de profesor). */
export type MasterBoardCourseCell = {
  subjectId: string;
  studentsAssessed: number;
  metrics: MetricValue[];
  /** Profesor `primary` de esa asignatura en ese curso, o `null` si no hay asignación. */
  teacher: MasterBoardTeacherRef | null;
  /** 1 → detalle directo; >1 → desambiguar; 0 → sin evaluación. */
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
  comparability: ComparabilityMeta;
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
