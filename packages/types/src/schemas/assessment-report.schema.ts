import { z } from 'zod';
import type { AnalyticsCapability, DataGranularity } from '../analytics-capabilities';
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
  // Granularidad del dato + capacidades derivadas. Mismo patrón que `hasGradingScale`
  // de abajo: un flag de disponibilidad en el payload para que la UI colapse secciones
  // en vez de renderizar ceros que parecen datos.
  //
  // `capabilities` va servido y no derivado en la web a propósito: el backend decide y
  // la web obedece, igual que con `suppressed`/`suppressionReason` del benchmarking. Si
  // mañana una capacidad depende de algo más que la granularidad (ej. que el instrumento
  // tenga tags), el contrato no cambia.
  //
  // Ojo: `instrumentType === 'dia'` NO sirve para esto — es una propiedad del
  // instrumento, no del dato. Un DIA cargado por planilla y uno cargado por PDF
  // agregado tienen el mismo `instrumentType` y capacidades distintas.
  dataGranularity: DataGranularity;
  capabilities: AnalyticsCapability[];
  /**
   * ¿Este informe se construyó con respuestas alumno×pregunta?
   *
   * Hermano exacto de `hasGradingScale`: un booleano de disponibilidad para que la UI
   * COLAPSE lo que no aplica en vez de pintar un cero que parece un dato. Es
   * `dataGranularity === 'item_level'`, servido y no derivado por la misma razón que
   * `capabilities` (el backend decide, la web obedece).
   *
   * Qué queda sin sustituto agregado cuando es `false` — y por lo tanto la UI debe
   * ocultar, no mostrar en cero ni con guión:
   *  · `items[].discrimination` y el flag `low_discrimination` que deriva de ella:
   *    D = p(27% superior) − p(27% inferior) necesita el puntaje de CADA alumno para
   *    partir la cohorte en grupos. Es irreducible; no se deriva de conteos por curso.
   *  · `studentsAtRisk[].weakestSkill`: es un ranking POR ALUMNO sobre `skill_results`.
   *  · `courseComparison[].*` de logro y la distribución por nivel cuando el informe se
   *    cargó SIN niveles por alumno: dependen del dato por alumno / de la Figura 1.
   *
   * Lo que sí sigue completo con `false` (viene del read-model de cohorte, no de
   * `responses`): `items[]` dificultad + distractor + blancos, `skills[]`, la
   * distribución por banda y la nómina de alumnos con su nivel. Y `summary.averageAchievement`
   * / `performanceLevel`: el % de LOGRO DEL CURSO (Σ score / Σ max de `assessment_item_stats`)
   * sí es agregable —es el número que el propio informe DIA publica— y se deriva del
   * read-model de ítems; sólo el % POR ALUMNO es irreducible.
   */
  hasItemLevelData: boolean;
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
  //
  // SIEMPRE null cuando `meta.hasItemLevelData === false`: partir la cohorte en 27%
  // superior/inferior exige el puntaje de cada alumno, que un informe oficial no
  // entrega. Es lo único de esta fila que no tiene sustituto agregado — dificultad,
  // distractor y blancos salen del read-model de cohorte y vienen completos igual.
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
