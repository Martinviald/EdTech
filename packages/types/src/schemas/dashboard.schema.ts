import { z } from 'zod';
import { PERFORMANCE_LEVELS, type AssessmentStatus, type PerformanceLevel } from '../enums';

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 4 — Dashboards core (H6.1, H6.2, H6.4, H6.5, H6.7, H6.8)
// Módulo backend: apps/api/src/dashboards/  (ruta base /api/dashboards)
//
// Todos los endpoints respetan el scoping por rol del usuario autenticado
// (directivo = toda la org; profesor = sólo sus cursos asignados vía
// teacher_assignments). El scope se resuelve en el service con la misma lógica
// que assessment-results.getAccessibleClassGroupIds — NO se confía en el query.
// ─────────────────────────────────────────────────────────────────────────────

// ── Query DTOs ───────────────────────────────────────────────────────────────

/**
 * Filtros compartidos por todos los dashboards (H6.2). Todos opcionales: la
 * vista por defecto agrega sobre todo lo visible para el usuario.
 */
export const dashboardFiltersQuerySchema = z.object({
  assessmentId: z.string().uuid().optional(),
  instrumentId: z.string().uuid().optional(),
  instrumentType: z.string().min(1).optional(),
  subjectId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  classGroupId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
});
export type DashboardFiltersQueryDto = z.infer<typeof dashboardFiltersQuerySchema>;

/** H6.4 — distribución + clasificación paginada de alumnos. */
export const dashboardPerformanceQuerySchema = dashboardFiltersQuerySchema.extend({
  performanceLevel: z.enum(PERFORMANCE_LEVELS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type DashboardPerformanceQueryDto = z.infer<typeof dashboardPerformanceQuerySchema>;

/**
 * H6.5 (drill-down jerárquico) — GET /api/dashboards/skills/breakdown.
 * Desglosa el % de logro de UN nodo de taxonomía (`nodeId`) por la dimensión
 * `groupBy`, respetando los mismos filtros del resto de dashboards. Alimenta la
 * escalera Asignatura → Nivel → Curso → Evaluación → Pregunta: cada `groupBy`
 * produce las filas de un peldaño; la fila seleccionada acota el siguiente.
 */
export const SKILL_BREAKDOWN_DIMENSIONS = ['subject', 'grade', 'classGroup', 'assessment'] as const;
export type SkillBreakdownDimension = (typeof SKILL_BREAKDOWN_DIMENSIONS)[number];

export const dashboardSkillBreakdownQuerySchema = dashboardFiltersQuerySchema.extend({
  nodeId: z.string().uuid(),
  groupBy: z.enum(SKILL_BREAKDOWN_DIMENSIONS),
});
export type DashboardSkillBreakdownQueryDto = z.infer<typeof dashboardSkillBreakdownQuerySchema>;

// ── Response Models ──────────────────────────────────────────────────────────

/** Bucket de distribución por nivel de desempeño. Reutilizado por analytics. */
export type PerformanceDistributionBucket = {
  level: PerformanceLevel;
  count: number;
  percentage: number; // 0..100, proporción del total
};

export type DashboardAssessmentSummary = {
  assessmentId: string;
  name: string | null;
  instrumentName: string;
  instrumentType: string;
  subjectName: string | null;
  gradeName: string | null;
  administeredAt: string | Date | null;
  studentsCount: number;
  averageAchievement: number | null; // % logro promedio 0..100
  status: AssessmentStatus;
};

export type DashboardAlert = {
  type: 'low_achievement' | 'critical_skill' | 'incomplete';
  severity: 'high' | 'medium' | 'low';
  message: string;
  contextId: string | null; // classGroupId o nodeId asociado
  contextLabel: string | null;
  value: number | null; // métrica asociada (% logro, conteo, etc.)
};

/** H6.1 / H6.7 — GET /api/dashboards/overview */
export type DashboardOverviewResponse = {
  scope: 'org' | 'teacher';
  globalAchievement: number | null; // % logro global 0..100
  studentsEvaluated: number;
  assessmentsCount: number;
  performanceDistribution: PerformanceDistributionBucket[];
  recentAssessments: DashboardAssessmentSummary[];
  alerts: DashboardAlert[];
};

// ── H6.2 — GET /api/dashboards/filters ───────────────────────────────────────

export type FilterOption = {
  id: string;
  label: string;
};

export type ClassGroupFilterOption = {
  id: string;
  label: string;
  gradeId: string | null;
  academicYearId: string | null;
};

export type PeriodFilterOption = {
  id: string; // academicYearId
  year: number;
  label: string;
  isCurrent: boolean;
};

export type InstrumentFilterOption = {
  id: string;
  label: string;
  type: string;
  subjectId: string | null;
  gradeId: string | null;
};

export type DashboardFilterOptionsResponse = {
  subjects: FilterOption[];
  grades: FilterOption[];
  classGroups: ClassGroupFilterOption[];
  periods: PeriodFilterOption[];
  instruments: InstrumentFilterOption[];
};

// ── H6.4 — GET /api/dashboards/performance ───────────────────────────────────

export type StudentClassificationModel = {
  studentId: string;
  studentRut: string;
  studentFullName: string;
  classGroupId: string | null;
  classGroupName: string | null;
  achievement: number | null; // % logro 0..100 (promedio si abarca varias evaluaciones)
  grade: string | null; // nota
  performanceLevel: PerformanceLevel | null;
};

export type DashboardPerformanceResponse = {
  distribution: PerformanceDistributionBucket[];
  // Umbrales configurables (0..1) tomados de la grading scale aplicable.
  thresholds: {
    elementary: number;
    adequate: number;
    advanced: number;
  };
  students: {
    data: StudentClassificationModel[];
    total: number;
    page: number;
    limit: number;
  };
};

// ── H6.5 — GET /api/dashboards/skills ────────────────────────────────────────

export type SkillAchievementModel = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  nodeCode: string | null;
  parentId: string | null;
  studentsAssessed: number;
  averageAchievement: number | null; // % logro promedio 0..100
  performanceLevel: PerformanceLevel | null;
};

export type DashboardSkillsResponse = {
  skills: SkillAchievementModel[];
};

/**
 * Una fila del desglose de un nodo por una dimensión (Asignatura/Nivel/Curso/
 * Evaluación). `id` es la clave de esa dimensión (subjectId/gradeId/classGroupId/
 * assessmentId), usada para acotar el siguiente peldaño del drill-down.
 */
export type SkillBreakdownRow = {
  id: string;
  label: string;
  sublabel: string | null; // contexto secundario (nivel del curso, fecha de la evaluación…)
  averageAchievement: number | null; // % logro promedio 0..100
  performanceLevel: PerformanceLevel | null;
  studentsAssessed: number;
};

/** GET /api/dashboards/skills/breakdown — un peldaño del drill-down jerárquico. */
export type DashboardSkillBreakdownResponse = {
  node: {
    nodeId: string;
    nodeName: string;
    nodeType: string;
    nodeCode: string | null;
  };
  groupBy: SkillBreakdownDimension;
  rows: SkillBreakdownRow[];
};

// ── H6.8 — GET /api/dashboards/teacher-kpis ──────────────────────────────────

export type TeacherCourseKpiModel = {
  classGroupId: string;
  classGroupName: string;
  gradeName: string | null;
  subjectName: string | null;
  studentsCount: number;
  averageAchievement: number | null; // % logro promedio 0..100
  passingRate: number | null; // % alumnos sobre passing_grade, 0..100
  criticalStudents: number; // alumnos en nivel 'insufficient'
  assessmentsCount: number;
};

export type DashboardTeacherKpisResponse = {
  courses: TeacherCourseKpiModel[];
};
