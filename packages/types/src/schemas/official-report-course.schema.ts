import { z } from 'zod';
import type { DataGranularity } from '../analytics-capabilities';
import type { PerformanceLevel } from '../enums';
import type {
  PerformanceBandDistributionBucket,
  PerformanceDistributionBucket,
} from './dashboard.schema';
import type { PerformanceBandView } from './performance-band.schema';
import type { OfficialReportMeta } from './official-report-common.schema';

// ─────────────────────────────────────────────────────────────────────────────
// TKT-24 — Informe oficial por curso × asignatura × momento
// GET /api/reports/course?assessmentId=...&classGroupId=...
//
// Replica las 6 secciones del informe oficial (hoy DIA) como PLANTILLA sobre los
// datos que la plataforma ya calcula (assessment_results, skill_results,
// responses). Reutiliza el análisis psicométrico y de habilidades del
// assessment-report interno; agrega la tabla de especificaciones con distribución
// por alternativa y el listado COMPLETO de estudiantes.
// ─────────────────────────────────────────────────────────────────────────────

export const officialCourseReportQuerySchema = z.object({
  assessmentId: z.string().uuid(),
  // Acota el informe a un único curso de la evaluación. Si la evaluación abarca
  // un solo curso, es opcional.
  classGroupId: z.string().uuid().optional(),
});
export type OfficialCourseReportQueryDto = z.infer<typeof officialCourseReportQuerySchema>;

// ── Sección 1: Portada + metadatos ───────────────────────────────────────────

export type OfficialCourseReportMeta = OfficialReportMeta & {
  classGroup: { id: string; name: string; gradeName: string | null } | null;
  teacherName: string | null; // docente de la asignatura (mejor esfuerzo)
  administeredAt: string | Date | null;
  studentsConsidered: number; // N° de estudiantes con resultados considerados
  // Granularidad del dato de la evaluación. `aggregate_only` (informe oficial cargado
  // sin niveles por alumno) → la web oculta los widgets que dependen del nivel por
  // alumno (distribución por nivel y "requiere apoyo"), que no salen del agregado.
  dataGranularity: DataGranularity;
};

// ── Sección 2: Resultado general del curso ───────────────────────────────────

/**
 * Resultado general. Trae SIEMPRE ambas vistas:
 * - `requiresSupport*`: destacado en Diagnóstico (estudiantes en el nivel más bajo).
 * - `distribution`: destacado en Monitoreo/Cierre (torta de niveles de logro).
 */
export type OfficialCourseGeneralResult = {
  studentsConsidered: number;
  averageAchievement: number | null; // % 0..100
  performanceLevel: PerformanceLevel | null;
  // Estudiantes en el nivel de logro más bajo ("requieren mayor apoyo").
  requiresSupportCount: number;
  requiresSupportPercentage: number | null; // 0..100
  distribution: PerformanceDistributionBucket[]; // torta por nivel de logro
};

// ── Sección 3: Resultados según ejes de habilidad ────────────────────────────

export type OfficialCourseSkillAxis = {
  nodeId: string;
  nodeName: string;
  nodeType: string; // axis | skill | … (tipo del taxonomy_node)
  nodeCode: string | null;
  studentsAssessed: number;
  averageAchievement: number | null; // % 0..100 (barra)
  performanceLevel: PerformanceLevel | null;
};

// ── Sección 4: Tabla de especificaciones (por pregunta) ──────────────────────

/** Distribución de respuestas de una alternativa (preguntas de selección). */
export type OfficialAlternativeDistribution = {
  key: string; // "A" | "B" | …
  text: string | null;
  isCorrect: boolean;
  count: number;
  percentage: number; // 0..100 sobre el total de respuestas
};

/**
 * Bucket de una pregunta de desarrollo (RC/RPC/RI/N), derivado del puntaje del
 * alumno sobre el máximo del ítem — genérico, no atado a un instrumento:
 * - `RC`  (Respuesta Correcta): score == maxScore
 * - `RPC` (Respuesta Parcialmente Correcta): 0 < score < maxScore
 * - `RI`  (Respuesta Incorrecta): score == 0
 * - `N`   (No responde): sin respuesta / en blanco
 */
export const DEVELOPMENT_SCORE_CATEGORIES = ['RC', 'RPC', 'RI', 'N'] as const;
export type DevelopmentScoreCategory = (typeof DEVELOPMENT_SCORE_CATEGORIES)[number];

export type OfficialDevelopmentDistribution = {
  category: DevelopmentScoreCategory;
  count: number;
  percentage: number; // 0..100
};

/**
 * Una fila de la tabla de especificaciones. Las columnas taxonómicas
 * (oa/textType/axis/skill/indicator) se derivan por el `type` del taxonomy_node
 * etiquetado en el ítem — sin hardcodear ningún instrumento. Cualquiera puede ser
 * null si el ítem no tiene ese tag.
 */
export type OfficialSpecTableRow = {
  itemId: string;
  position: number; // N° de pregunta
  itemType: string; // item_type
  oaCode: string | null; // nodo learning_objective (ej. "OA 4")
  oaName: string | null;
  textType: string | null; // nodo text_type
  axis: string | null; // nodo axis (eje de habilidad)
  skill: string | null; // nodo skill
  indicator: string | null; // nodo descriptor/criterion (indicador de evaluación)
  correctKey: string | null;
  totalResponses: number;
  blankCount: number;
  correctCount: number;
  correctRate: number | null; // 0..100
  difficulty: number | null; // 0..100 (p = aciertos/total)
  // Selección múltiple → alternatives poblado, development null. Desarrollo → al revés.
  alternatives: OfficialAlternativeDistribution[];
  developmentDistribution: OfficialDevelopmentDistribution[] | null;
};

// ── Sección 5: Resultados por estudiante ─────────────────────────────────────

export type OfficialCourseStudentRow = {
  studentId: string;
  studentRut: string;
  studentFullName: string;
  classGroupId: string | null;
  classGroupName: string | null;
  achievement: number | null; // % de logro 0..100
  grade: number | null;
  performanceLevel: PerformanceLevel | null;
  requiresSupport: boolean; // cae en el nivel de logro más bajo
  // Banda real del instrumento resuelta para el alumno (ej. DIA "Nivel II"). El
  // color/orden lo aporta `bands` a nivel de respuesta. `null` cuando el
  // instrumento no tiene bandas → la web usa la etiqueta del enum legacy.
  bandLabel?: string | null;
  bandKey?: string | null;
  // Banda del nivel PREVIO (Monitoreo Intermedio) del alumno, sólo en informes de
  // Cierre. Cuando está presente, §5 muestra el avance `priorBandLabel → bandLabel`
  // (ej. "Nivel I → Nivel II"). `null`/ausente en Monitoreo/Diagnóstico/item_level.
  priorBandLabel?: string | null;
  priorBandKey?: string | null;
};

// ── Respuesta ────────────────────────────────────────────────────────────────

export type OfficialCourseReportResponse = {
  meta: OfficialCourseReportMeta; // Sección 1
  generalResult: OfficialCourseGeneralResult; // Sección 2
  skillAxes: OfficialCourseSkillAxis[]; // Sección 3 (ordenado por logro asc: brechas primero)
  specTable: OfficialSpecTableRow[]; // Sección 4 (ordenado por posición)
  studentResults: OfficialCourseStudentRow[]; // Sección 5 (ordenado por apellido)
  // Sección 6: preguntas reflexivas para completar (data-driven vía
  // `instruments.config.reportReflectionPrompts`, con un set genérico por defecto).
  reflectionPrompts: string[];
  // Bandas configuradas del instrumento (N niveles data-driven, ej. DIA I/II/III) y
  // su distribución por banda para §2. Presentes SÓLO cuando el instrumento tiene
  // bandas; en ese caso la UI las prefiere sobre `generalResult.distribution` (la
  // escala fija de 4 niveles). Sin bandas quedan `undefined` → la web cae a los 4
  // niveles legacy, sin regresión para instrumentos no-DIA.
  bands?: PerformanceBandView[];
  bandDistribution?: PerformanceBandDistributionBucket[];
};
