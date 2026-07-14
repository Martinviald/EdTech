import { z } from 'zod';
import type { PerformanceLevel } from '../enums';
import type {
  PerformanceBandDistributionBucket,
  PerformanceDistributionBucket,
} from './dashboard.schema';
import type { PerformanceBandView } from './performance-band.schema';

// ─────────────────────────────────────────────────────────────────────────────
// Informe de Evaluación (H6.13) — vista consolidada y conclusiva por evaluación
// para el equipo directivo / UTP. A diferencia de los dashboards exploratorios,
// reúne en una sola respuesta: ficha técnica, síntesis ejecutiva, distribución,
// comparativa por curso, fortalezas/brechas por habilidad, análisis psicométrico
// de ítems (dificultad + discriminación) y recomendaciones accionables.
//
// Módulo backend: apps/api/src/assessment-report/ (ruta /api/analytics/assessment-report)
// El scoping por rol lo aplica el service (directivo = toda la org; profesor =
// sólo sus cursos). NO se confía en el query para filtrar tenants.
// ─────────────────────────────────────────────────────────────────────────────

// ── Query DTO ────────────────────────────────────────────────────────────────

export const assessmentReportQuerySchema = z.object({
  assessmentId: z.string().uuid(),
  // Opcional: acota el informe a un curso específico de la evaluación (drill-down).
  classGroupId: z.string().uuid().optional(),
});
export type AssessmentReportQueryDto = z.infer<typeof assessmentReportQuerySchema>;

// ── Sub-modelos ──────────────────────────────────────────────────────────────

/** Flags automáticos de calidad/criticidad de un ítem (psicometría). */
export const ITEM_REPORT_FLAGS = [
  'critical', // p < 0.4 → contenido no logrado por la mayoría
  'low_discrimination', // D < 0.2 → la pregunta no separa buenos de malos: revisar
  'strong_distractor', // un distractor atrae más respuestas que la clave correcta
  'easy', // p >= 0.85 → ítem muy fácil (poco aporte diagnóstico)
] as const;
export type ItemReportFlag = (typeof ITEM_REPORT_FLAGS)[number];

/** Ficha técnica de la evaluación. */
export type AssessmentReportMeta = {
  assessmentId: string;
  assessmentName: string | null;
  instrumentId: string;
  instrumentName: string;
  instrumentType: string;
  subjectName: string | null;
  gradeName: string | null;
  administeredAt: string | Date | null;
  classGroups: { id: string; name: string }[];
  itemsCount: number;
};

/** Síntesis ejecutiva: los números que responden "¿cómo nos fue?". */
export type AssessmentReportSummary = {
  studentsEvaluated: number;
  studentsEnrolled: number; // matriculados en los cursos de la evaluación
  coverageRate: number | null; // % evaluados / matriculados, 0..100
  averageAchievement: number | null; // % logro promedio 0..100
  // TKT-04 — `hasGradingScale` distingue explícitamente "el instrumento no tiene
  // escala de notas configurada" de "escala con corte 4.0". Cuando es `false`,
  // todos los campos de nota (averageGrade, passingGrade, passingRate) vienen
  // `null`: NO se inventa un default 4.0. El % de logro y el nivel de desempeño
  // (que no dependen de la escala de notas) se siguen reportando.
  hasGradingScale: boolean;
  averageGrade: number | null; // nota promedio (null si no hay escala)
  passingGrade: number | null; // umbral de aprobación usado (null si no hay escala)
  passingRate: number | null; // % alumnos sobre el umbral, 0..100 (null si no hay escala)
  performanceLevel: PerformanceLevel | null; // nivel del logro promedio
  performanceBand?: PerformanceBandView | null; // banda del instrumento, si aplica
};

/** Una fila de la comparativa por curso (intra-evaluación). */
export type AssessmentReportCourseRow = {
  classGroupId: string;
  classGroupName: string;
  studentsEvaluated: number;
  averageAchievement: number | null; // % 0..100
  passingRate: number | null; // % 0..100
  criticalStudents: number; // en nivel insufficient o elementary
  gapVsAverage: number | null; // averageAchievement − promedio global, en puntos %
};

/** Logro por habilidad/eje (ranking de fortalezas y brechas). */
export type AssessmentReportSkillRow = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  nodeCode: string | null;
  studentsAssessed: number;
  averageAchievement: number | null; // % 0..100
  performanceLevel: PerformanceLevel | null;
  performanceBand?: PerformanceBandView | null;
};

/** Análisis psicométrico de un ítem. */
export type AssessmentReportItemRow = {
  itemId: string;
  position: number;
  skillName: string | null;
  contentName: string | null;
  correctKey: string | null;
  answeredCount: number;
  blankCount: number;
  totalResponses: number;
  // Índice de dificultad p: % de aciertos sobre el total de quienes respondieron
  // (incluye blancos como incorrectos). Bajo = difícil.
  difficulty: number | null; // 0..100
  // Índice de discriminación D = p(27% superior) − p(27% inferior), −1..1. Bajo o
  // negativo = la pregunta no distingue a quienes dominan de quienes no.
  discrimination: number | null; // -1..1
  topDistractorKey: string | null; // alternativa incorrecta más elegida
  topDistractorRate: number | null; // % que la eligió, 0..100
  flags: ItemReportFlag[];
};

/** Alumno en foco de intervención (nivel bajo). */
export type AssessmentReportRiskStudent = {
  studentId: string;
  studentRut: string;
  studentFullName: string;
  classGroupName: string | null;
  achievement: number | null; // % 0..100
  performanceLevel: PerformanceLevel | null;
  performanceBand?: PerformanceBandView | null;
  weakestSkill: string | null; // habilidad con menor logro del alumno
};

export const RECOMMENDATION_TYPES = [
  'reteach_skill',
  'review_item',
  'support_students',
  'celebrate',
] as const;
export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

/** Recomendación accionable derivada por reglas (no IA en F1). */
export type AssessmentReportRecommendation = {
  type: RecommendationType;
  priority: 'high' | 'medium' | 'low';
  message: string;
};

// ── Respuesta ────────────────────────────────────────────────────────────────

export type AssessmentReportResponse = {
  meta: AssessmentReportMeta;
  summary: AssessmentReportSummary;
  distribution: PerformanceDistributionBucket[];
  // Bandas del instrumento y distribución por banda (el informe es siempre de un
  // único instrumento). Presentes cuando el instrumento tiene bandas configuradas;
  // la UI las prefiere sobre `distribution` (4 niveles legacy).
  bands?: PerformanceBandView[];
  bandDistribution?: PerformanceBandDistributionBucket[];
  courseComparison: AssessmentReportCourseRow[]; // ordenado por logro desc
  skills: AssessmentReportSkillRow[]; // ordenado por logro asc (brechas primero)
  highlights: {
    strengths: string[]; // hasta 3 habilidades de mayor logro
    gaps: string[]; // hasta 3 habilidades de menor logro
  };
  items: AssessmentReportItemRow[]; // ordenado por posición
  studentsAtRisk: AssessmentReportRiskStudent[]; // nivel bajo, peor logro primero
  recommendations: AssessmentReportRecommendation[];
};
