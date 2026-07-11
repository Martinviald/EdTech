import { z } from 'zod';
import type { PerformanceLevel } from '../enums';
import type { OfficialReportVariant } from './official-report-common.schema';

// ─────────────────────────────────────────────────────────────────────────────
// TKT-25 — Informe de establecimiento (Área Académica)
// GET /api/reports/establishment?academicYearId=...&period=...
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

export const officialEstablishmentReportQuerySchema = z.object({
  // Año académico a reportar. Si se omite, el service usa el año marcado
  // `is_current` de la organización.
  academicYearId: z.string().uuid().optional(),
  // Momento (Diagnóstico/Monitoreo/Cierre) a reportar: filtra las evaluaciones
  // por `assessments.config.period`. Si se omite, incluye todas las del año.
  period: z.string().min(1).max(60).optional(),
});
export type OfficialEstablishmentReportQueryDto = z.infer<
  typeof officialEstablishmentReportQuerySchema
>;

/** Un grado presente como columna de las tablas agregadas. */
export type EstablishmentGradeColumn = {
  gradeId: string;
  gradeName: string;
  gradeOrder: number;
};

/**
 * Celda de la Tabla 1.1–1.4 (niveles de logro): % de estudiantes de un grado en
 * un nivel para una asignatura. `count`/`total` permiten reconstruir el conteo.
 * Sparse: grados/niveles sin datos simplemente no aparecen.
 */
export type EstablishmentLevelCell = {
  gradeId: string;
  level: PerformanceLevel;
  count: number;
  total: number; // estudiantes del grado en esa asignatura (denominador)
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
  levels: PerformanceLevel[]; // niveles con datos (filas de las tablas 1.1–1.4)
  grades: EstablishmentGradeColumn[]; // grados con datos (columnas), ordenados
  // Tabla 1.1–1.4 (una por asignatura): % de estudiantes por grado × nivel.
  levelDistribution: EstablishmentLevelCell[];
  // Tabla 1.5–1.8 (una por asignatura): comparación mujeres vs hombres por grado.
  sexComparison: EstablishmentSexComparisonRow[];
  // Tabla 1.9 (parte de la asignatura): conteo M/H/Total por grado.
  counts: EstablishmentCountRow[];
};

/**
 * Meta del informe de establecimiento: a nivel ORG (no de un instrumento único,
 * porque el informe agrega varias asignaturas/instrumentos). No extiende
 * `OfficialReportMeta` (que es por instrumento).
 */
export type OfficialEstablishmentReportMeta = {
  orgId: string;
  orgName: string;
  rbd: string | null;
  commune: string | null;
  region: string | null;
  directorName: string | null;
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
  // Si la plataforma pudo calcular la comparación por sexo (Tablas 1.5–1.8).
  // TRUE porque `students.gender` existe; puede ser parcial si faltan datos de
  // género. El frontend muestra las tablas 1.1–1.4 y 1.9 aunque esto sea false.
  sexDataAvailable: boolean;
  // Nota de alcance (Área Socioemocional fuera de alcance) — informativa.
  scopeNotes: string[];
};
