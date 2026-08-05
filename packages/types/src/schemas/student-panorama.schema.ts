// ── Vista 360 del estudiante (T2-20 · #2B) ───────────────────────────────────
// Panorama consolidado de UN alumno a través de sus evaluaciones: por evaluación,
// por habilidad/eje y por nivel de desempeño. NO introduce datos nuevos — reagrega
// lo ya calculado en `assessment_results` y `skill_results`.
//
// Ver docs/diseno-vista-360-estudiante.md. El endpoint no recibe body: su única
// entrada es el `:id` del alumno, validado con `ParseUUIDPipe`.
import type { PerformanceLevel } from '../enums';
import type { DataGranularity } from '../analytics-capabilities';
import type { PerformanceBandView } from './performance-band.schema';
import type {
  PerformanceBandDistributionBucket,
  PerformanceDistributionBucket,
} from './dashboard.schema';

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
  subjectName: string | null;
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
  /** % 0..100 del alumno para el nodo = correctCount / totalCount. */
  achievement: number | null;
  correctCount: number;
  totalCount: number;
  /** Cuántas evaluaciones aportan a este nodo para el alumno. */
  assessmentsCount: number;
  performanceLevel: PerformanceLevel | null;
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
   * % de logro promedio del alumno, o null. Se calcula SÓLO sobre las
   * evaluaciones que aportan porcentaje: `assessmentsWithAchievement` es su
   * denominador real y no tiene por qué coincidir con `assessmentsCount`.
   */
  averageAchievement: number | null;
  assessmentsWithAchievement: number;
  skillsAssessed: number;
};

export type StudentPanoramaResponse = {
  student: StudentPanoramaHeader;
  summary: StudentPanoramaSummary;
  /** Trayectoria por evaluación, ordenada por fecha de aplicación ascendente. */
  byAssessment: StudentPanoramaAssessment[];
  /** Habilidades/ejes/OAs, ordenados por logro ascendente (más críticos primero). */
  bySkill: StudentPanoramaSkill[];
  /** Distribución de desempeño, o el motivo por el que no se puede clasificar. */
  distribution: StudentPanoramaDistribution;
};
