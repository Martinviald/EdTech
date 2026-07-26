// ── Vista 360 del estudiante (T2-20) ─────────────────────────────────────────
// Panorama consolidado de UN alumno a través de sus evaluaciones: por evaluación,
// por habilidad/eje y por nivel de desempeño, a lo largo del período. NO introduce
// datos nuevos — reagrega lo ya calculado en `assessment_results` y `skill_results`.
//
// Modelos de respuesta como tipos TS (misma convención que
// `assessment-result.schema.ts` / `dashboard.schema.ts`). El endpoint no recibe
// body: su única entrada es el `:id` del alumno, validado con `ParseUUIDPipe`.
import type { PerformanceLevel } from '../enums';
import type { PerformanceBandView } from './performance-band.schema';
import type { PerformanceDistributionBucket } from './dashboard.schema';

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
  instrumentName: string;
  subjectName: string | null;
  administeredAt: string | Date | null;
  /** % de logro 0..100, o null si no evaluado. */
  achievement: number | null;
  /** Nota (decimal string), o null. */
  grade: string | null;
  performanceLevel: PerformanceLevel | null;
  /** Banda real del instrumento (ej. DIA I/II/III). null → usar el enum legacy. */
  performanceBand: PerformanceBandView | null;
};

/**
 * Logro del alumno agregado por nodo de taxonomía (habilidad/eje), promediando
 * sus `skill_results` a través de todas sus evaluaciones. El nivel se deriva del
 * promedio con los umbrales por defecto (F1 = DIA); en scope multi-escala aplica
 * la misma limitación documentada en heatmap/dashboards (revisar en F2).
 */
export type StudentPanoramaSkill = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  nodeCode: string | null;
  /** % promedio 0..100 del alumno para el nodo, o null. */
  averageAchievement: number | null;
  /** Cuántas evaluaciones aportan a este nodo para el alumno. */
  assessmentsCount: number;
  performanceLevel: PerformanceLevel | null;
};

/** KPIs de cabecera del panorama. */
export type StudentPanoramaSummary = {
  assessmentsCount: number;
  /** % de logro promedio del alumno a través de sus evaluaciones, o null. */
  averageAchievement: number | null;
  skillsAssessed: number;
};

export type StudentPanoramaResponse = {
  student: StudentPanoramaHeader;
  summary: StudentPanoramaSummary;
  /** Trayectoria por evaluación, ordenada por fecha de aplicación ascendente. */
  byAssessment: StudentPanoramaAssessment[];
  /** Habilidades/ejes, ordenados por logro ascendente (más críticos primero). */
  bySkill: StudentPanoramaSkill[];
  /** Distribución del alumno por nivel de desempeño (sobre sus evaluaciones). */
  byLevel: PerformanceDistributionBucket[];
};
