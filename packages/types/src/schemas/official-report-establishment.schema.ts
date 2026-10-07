import { z } from 'zod';
import type { PerformanceBandView } from './performance-band.schema';
import type { OfficialReportVariant } from './official-report-common.schema';

// ─────────────────────────────────────────────────────────────────────────────
// TKT-25 — Informe de establecimiento (Área Académica)
// GET /api/reports/establishment?processId=...
//
// Formato AGREGADO por grado × asignatura a nivel de toda la organización
// (distinto del informe por curso de TKT-24: no baja a pregunta ni a estudiante).
// Reproduce SÓLO la Sección 1 (Área Académica): Tablas 1.1–1.9. El Área
// Socioemocional (Sección 2) queda FUERA de alcance (la plataforma no ingesta
// ese cuestionario) — documentado como punto de extensión.
//
// Todo es data-driven: asignaturas de `subjects`, grados de `grades`, niveles del
// enum `performance_level`. Nada hardcodea "DIA"/asignaturas/grados.
// ─────────────────────────────────────────────────────────────────────────────

export const officialEstablishmentReportQuerySchema = z
  .object({
    // Proceso de medición a reportar (ej. "DIA Monitoreo 2026"). El proceso fija año,
    // momento y tipo de instrumento, así que el informe nunca mezcla resultados que no
    // son comparables. Sólo entran las evaluaciones con `assessments.process_id` = este.
    processId: z.string().uuid(),
  })
  .strict();
export type OfficialEstablishmentReportQueryDto = z.infer<
  typeof officialEstablishmentReportQuerySchema
>;

/** Cobertura de un grado: estudiantes evaluados contra los esperados por el proceso. */
export type EstablishmentCoverage = {
  evaluated: number;
  /** `null` si el proceso no permite derivar cuántos estudiantes se esperaban. */
  expected: number | null;
};

/** Evaluación del proceso que alimenta una columna (para listarlas cuando hay más de una). */
export type EstablishmentColumnAssessment = {
  id: string;
  name: string | null;
};

/**
 * Un grado presente como columna de las tablas de una asignatura. Cada columna sale de
 * UNA evaluación del proceso: si el grado × asignatura tiene más de una, la columna
 * queda sin números (`multipleAssessments`) en vez de mezclarlas.
 */
export type EstablishmentGradeColumn = {
  gradeId: string;
  gradeName: string;
  gradeOrder: number;
  /** Instrumento de la columna; `null` si `multipleAssessments`. */
  instrumentId: string | null;
  /** Evaluaciones del proceso en este grado × asignatura (más de una ⇒ `multipleAssessments`). */
  assessmentIds: string[];
  /** Las mismas evaluaciones de `assessmentIds`, con su nombre, en el mismo orden. */
  assessments: EstablishmentColumnAssessment[];
  multipleAssessments: boolean;
  /** El instrumento no tiene bandas: la columna no clasifica por nivel (nunca cortes heredados). */
  bandsMissing: boolean;
  /** Bandas del instrumento de la columna; `null` si `bandsMissing` o `multipleAssessments`. */
  bands: PerformanceBandView[] | null;
  coverage: EstablishmentCoverage;
};

/**
 * Celda de la Tabla 1.1–1.4: % de estudiantes de un grado en una banda del instrumento
 * de esa columna (ej. DIA Nivel I/II/III). Es la misma clasificación que usa el informe
 * por evaluación, así que ambos coinciden. `total` = estudiantes del grado con banda
 * resuelta.
 */
export type EstablishmentBandCell = {
  gradeId: string;
  bandKey: string;
  count: number;
  total: number;
  percentage: number; // 0..100
};

/**
 * Resultado de la comparación por sexo (Tablas 1.5–1.8) para un grado:
 * - `more_female`  (+M): mujeres significativamente mayor.
 * - `more_male`    (+H): hombres significativamente mayor.
 * - `no_difference` (vacío): sin diferencia estadísticamente significativa.
 * - `insufficient_sample` (*): no se alcanza el mínimo de estudiantes por grupo.
 *
 * Significancia: t de Welch (dos muestras, varianzas desiguales) sobre el % de
 * logro; significativo si |t| > 1.96 (~95%). Se requiere `MIN_N` por grupo
 * (constante documentada en el service) para calcular; si no, `insufficient_sample`.
 * Los umbrales son convenciones configurables, no un cálculo oficial DIA exacto.
 */
export const SEX_COMPARISON_RESULTS = [
  'more_female',
  'more_male',
  'no_difference',
  'insufficient_sample',
] as const;
export type SexComparisonResult = (typeof SEX_COMPARISON_RESULTS)[number];

export type EstablishmentSexComparisonRow = {
  gradeId: string;
  gradeName: string;
  gradeOrder: number;
  result: SexComparisonResult;
  femaleAvg: number | null; // % 0..100
  maleAvg: number | null;
  femaleN: number;
  maleN: number;
};

/** Fila de la Tabla 1.9 (conteo de estudiantes evaluados) por grado. */
export type EstablishmentCountRow = {
  gradeId: string;
  gradeName: string;
  gradeOrder: number;
  female: number;
  male: number;
  other: number; // gender 'X' / 'unspecified'
  total: number;
};

/**
 * Bloque de una asignatura dentro del informe de establecimiento.
 */
export type EstablishmentSubjectSection = {
  subjectId: string;
  subjectName: string;
  grades: EstablishmentGradeColumn[]; // grados con evaluación en el proceso, ordenados
  // Bandas compartidas por TODAS las columnas con bandas de la asignatura (mismo set
  // de claves): con ellas la Tabla 1.1–1.4 es una sola tabla. `null` si las columnas
  // traen sets distintos: la UI muestra cada columna con sus propias bandas.
  bands: PerformanceBandView[] | null;
  // Tabla 1.1–1.4: % de estudiantes por grado × banda (de la banda de cada columna).
  bandDistribution: EstablishmentBandCell[];
  // Tabla 1.5–1.8: comparación mujeres vs hombres por grado, dentro de cada columna
  // (un solo instrumento). `femaleAvg`/`maleAvg` son medias de los % individuales
  // porque son el estadístico del t de Welch (excepción acordada al logro unificado).
  sexComparison: EstablishmentSexComparisonRow[];
  // Tabla 1.9 (parte de la asignatura): conteo M/H/Total por grado.
  counts: EstablishmentCountRow[];
};

/**
 * Meta del informe de establecimiento: a nivel ORG y de un PROCESO de medición (no de
 * un instrumento único, porque el informe agrega varias asignaturas/instrumentos). No
 * extiende `OfficialReportMeta` (que es por instrumento).
 */
export type OfficialEstablishmentReportMeta = {
  orgId: string;
  orgName: string;
  rbd: string | null;
  commune: string | null;
  region: string | null;
  directorName: string | null;
  processId: string;
  processName: string;
  academicYearId: string;
  academicYear: number | null;
  period: string | null;
  periodLabel: string | null;
  generatedAt: string; // ISO
  disclaimers: string[]; // data-driven (unión de config.reportDisclaimers de los instrumentos)
  variant: OfficialReportVariant;
};

export type OfficialEstablishmentReportResponse = {
  meta: OfficialEstablishmentReportMeta;
  // Definición de niveles de logro (texto interpretativo) — data-driven vía
  // `instruments.config.levelDefinitions`; `[]` si no está configurado.
  levelDefinitions: string[];
  subjects: EstablishmentSubjectSection[];
  // Alguna columna del proceso clasifica por bandas. Si es false (ej. un proceso que se
  // lee en puntaje), la UI no muestra las tablas de niveles y lo explica.
  bandsAvailable: boolean;
  // Si la plataforma pudo calcular la comparación por sexo (Tablas 1.5–1.8).
  // TRUE porque `students.gender` existe; puede ser parcial si faltan datos de
  // género. El frontend muestra las tablas 1.1–1.4 y 1.9 aunque esto sea false.
  sexDataAvailable: boolean;
  // Nota de alcance (Área Socioemocional fuera de alcance) — informativa.
  scopeNotes: string[];
};
