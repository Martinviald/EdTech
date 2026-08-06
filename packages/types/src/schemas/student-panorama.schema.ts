// ── Vista 360 del estudiante (T2-20 · #2B) ───────────────────────────────────
// Panorama consolidado de UN alumno a través de sus evaluaciones: por evaluación,
// por habilidad/eje y por nivel de desempeño. NO introduce datos nuevos — reagrega
// lo ya calculado en `assessment_results` y `skill_results`.
//
// Ver docs/diseno-vista-360-estudiante.md. El endpoint no recibe body: su única
// entrada es el `:id` del alumno, validado con `ParseUUIDPipe`.
import { z } from 'zod';
import type { PerformanceLevel } from '../enums';
import type { DataGranularity } from '../analytics-capabilities';
import type { ComparabilityMeta } from '../comparability';
import type { PerformanceBandView } from './performance-band.schema';
import {
  INSTRUMENT_APPLICATION_PERIODS,
  type InstrumentApplicationPeriod,
} from './instrument.schema';
import type {
  PerformanceBandDistributionBucket,
  PerformanceDistributionBucket,
} from './dashboard.schema';

/**
 * Filtros de la vista 360. El zoom ES el filtro: cada nivel lo estrecha y el
 * breadcrumb lo refleja. `year` tiene default implícito en el backend (el año más
 * reciente con resultados del alumno), porque "todo el historial" mezcla grados y
 * es justo lo que el principio rector prohíbe; `allYears` lo desactiva a propósito.
 */
export const studentPanoramaQuerySchema = z.object({
  subjectId: z.string().uuid().optional(),
  instrumentType: z.string().min(1).optional(),
  applicationPeriod: z.enum(INSTRUMENT_APPLICATION_PERIODS).optional(),
  year: z.coerce.number().int().optional(),
  allYears: z.coerce.boolean().optional(),
});
export type StudentPanoramaQueryDto = z.infer<typeof studentPanoramaQuerySchema>;

/** Cabecera del alumno: identidad + curso vigente (best-effort, matrícula más reciente). */
export type StudentPanoramaHeader = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  rut: string;
  classGroup: { id: string; name: string; gradeName: string } | null;
};

/** Un resultado del alumno en una evaluación (grano alumno × evaluación). */
export type StudentPanoramaAssessment = {
  assessmentId: string;
  assessmentName: string | null;
  instrumentId: string;
  instrumentName: string;
  instrumentType: string;
  subjectId: string | null;
  subjectName: string | null;
  gradeId: string | null;
  year: number | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  /** Clave N2 del instrumento (mismo estándar a través de los años). */
  familyKey: string;
  /** Clave N3 del instrumento (momentos del ciclo dentro de un año). */
  periodSeriesKey: string;
  administeredAt: string | Date | null;
  /**
   * % de logro 0..100, o null. Un informe oficial cargado en modo agregado
   * entrega el NIVEL del alumno y no su porcentaje: esas filas llegan con
   * `achievement: null` y su desempeño sólo en `performanceBand`.
   */
  achievement: number | null;
  /** Nota (decimal string), o null. */
  grade: string | null;
  performanceLevel: PerformanceLevel | null;
  /** Banda real del instrumento (ej. DIA I/II/III). null → usar el enum legacy. */
  performanceBand: PerformanceBandView | null;
  /**
   * Banda del momento comparable anterior, cuando la ingesta la persistió
   * (informes de Cierre). Habilita leer el movimiento `priorBand → band` sin
   * resolver una línea base.
   */
  priorPerformanceBand: PerformanceBandView | null;
  /** Granularidad del dato: `aggregate_only` no tiene detalle por pregunta. */
  dataGranularity: DataGranularity;
};

/**
 * Logro del alumno agregado por nodo de taxonomía (habilidad/eje/OA), sumando los
 * CONTEOS de sus `skill_results` a través de las evaluaciones — nunca promediando
 * porcentajes, que daría el mismo peso a un nodo medido con 3 ítems y a otro
 * medido con 12 (misma doctrina que el read-model de cohorte).
 */
export type StudentPanoramaSkill = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  nodeCode: string | null;
  /** Padre en la taxonomía. Arma el zoom eje → habilidad → OA (`bySkillTree`). */
  parentNodeId: string | null;
  /** % 0..100 del alumno para el nodo = correctCount / totalCount. */
  achievement: number | null;
  correctCount: number;
  totalCount: number;
  /** Cuántas evaluaciones aportan a este nodo para el alumno. */
  assessmentsCount: number;
  performanceLevel: PerformanceLevel | null;
};

/**
 * El mismo logro por nodo, anidado por `parentNodeId`. Cada nivel conserva su
 * propio dato persistido (no se recalcula desde los hijos): un eje tiene su fila
 * en `skill_results` porque los ítems se etiquetan con el eje además del OA. Un
 * nodo cuyo padre no está evaluado sube a raíz, así el árbol nunca esconde datos.
 */
export type StudentPanoramaSkillNode = StudentPanoramaSkill & {
  children: StudentPanoramaSkillNode[];
};

/**
 * Distribución de desempeño del alumno. Discriminada porque no siempre se puede
 * clasificar: si sus resultados vienen de instrumentos con escalas de logro
 * distintas, un único gráfico mezclaría vocabularios que no son el mismo. En ese
 * caso NO se clasifica (regla de #1C), se declara `mixed` y la UI explica por qué.
 */
export type StudentPanoramaDistribution =
  | {
      kind: 'band';
      bands: PerformanceBandView[];
      buckets: PerformanceBandDistributionBucket[];
    }
  | { kind: 'level'; buckets: PerformanceDistributionBucket[] }
  | { kind: 'mixed'; scaleCount: number }
  | { kind: 'empty' };

/** KPIs de cabecera del panorama. */
export type StudentPanoramaSummary = {
  assessmentsCount: number;
  /**
   * % de logro promedio del alumno, o null. Dos razones para que venga null:
   * ninguna evaluación aporta porcentaje, o el alcance filtrado NO es agregable
   * (mezcla instrumentos) — en ese caso el motivo está en `comparability.reason`.
   * Cuando sí viene, `assessmentsWithAchievement` es su denominador real y no
   * tiene por qué coincidir con `assessmentsCount`.
   */
  averageAchievement: number | null;
  assessmentsWithAchievement: number;
  skillsAssessed: number;
};

/**
 * Un punto de una serie comparable del alumno. `label` es el eje X real de la
 * trayectoria: el momento del ciclo (N3) o el año (N2), NUNCA la fecha cruda —
 * ordenar por fecha es lo que hacía saltar la línea entre instrumentos distintos.
 */
export type StudentPanoramaSeriesPoint = {
  assessmentId: string;
  label: string;
  instrumentName: string;
  administeredAt: string | Date | null;
  achievement: number | null;
  performanceBand: PerformanceBandView | null;
  performanceLevel: PerformanceLevel | null;
};

/**
 * Una serie comparable: los mismos resultados leídos punto a punto. NO se promedian
 * entre sí (`comparability.aggregatable` es false para N2/N3) — se comparan.
 */
export type StudentPanoramaSeries = {
  kind: 'period_series' | 'instrument_family';
  key: string;
  label: string;
  points: StudentPanoramaSeriesPoint[];
};

/**
 * El alumno en UNA asignatura: el eje principal de la vista. El % de logro sólo se
 * emite cuando el alcance de la asignatura es agregable (N0/N1); si mezcla
 * instrumentos, viaja `null` con el motivo en `comparability.reason`.
 */
export type StudentPanoramaSubject = {
  subjectId: string | null;
  subjectName: string | null;
  assessmentsCount: number;
  achievement: number | null;
  comparability: ComparabilityMeta;
  latest: StudentPanoramaSeriesPoint | null;
  series: StudentPanoramaSeries[];
};

/** Opciones disponibles para los filtros, derivadas del historial del alumno. */
export type StudentPanoramaFilterOptions = {
  subjects: { id: string | null; name: string | null }[];
  instrumentTypes: string[];
  years: number[];
  applicationPeriods: InstrumentApplicationPeriod[];
};

/** Qué filtro quedó realmente aplicado (incluye el default de año que puso el backend). */
export type StudentPanoramaAppliedFilters = {
  subjectId: string | null;
  instrumentType: string | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  year: number | null;
  allYears: boolean;
};

export type StudentPanoramaResponse = {
  student: StudentPanoramaHeader;
  filters: StudentPanoramaAppliedFilters;
  filterOptions: StudentPanoramaFilterOptions;
  /** Comparabilidad del alcance filtrado completo. */
  comparability: ComparabilityMeta;
  /** El alumno por asignatura — el eje principal del panorama. */
  bySubject: StudentPanoramaSubject[];
  summary: StudentPanoramaSummary;
  /** Trayectoria por evaluación, ordenada por fecha de aplicación ascendente. */
  byAssessment: StudentPanoramaAssessment[];
  /** Habilidades/ejes/OAs planos, ordenados por logro ascendente (más críticos primero). */
  bySkill: StudentPanoramaSkill[];
  /** Los mismos nodos anidados por jerarquía, para el zoom eje → habilidad → OA. */
  bySkillTree: StudentPanoramaSkillNode[];
  /** Distribución de desempeño, o el motivo por el que no se puede clasificar. */
  distribution: StudentPanoramaDistribution;
};
