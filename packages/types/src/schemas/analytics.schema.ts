import { z } from 'zod';
import type { PerformanceLevel } from '../enums';
import type { PerformanceDistributionBucket } from './dashboard.schema';

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 4 — Analítica de series temporales (H6.3, H6.6)
// Módulo backend: apps/api/src/analytics/  (ruta base /api/analytics)
//
// Igual que dashboards, el scoping por rol lo aplica el service. Profesores ven
// sólo sus cursos; directivos ven toda la org.
// ─────────────────────────────────────────────────────────────────────────────

// ── H6.3 — Comparación de generaciones ───────────────────────────────────────
// Compara el mismo nivel (grade) entre años académicos distintos. Ej: 3° básico
// Lenguaje DIA 2025 vs 2024. Puede venir vacío si sólo hay datos de un período.

export const generationalComparisonQuerySchema = z.object({
  gradeId: z.string().uuid(),
  subjectId: z.string().uuid().optional(),
  instrumentType: z.string().min(1).optional(),
  nodeId: z.string().uuid().optional(), // opcional: enfocar una habilidad
});
export type GenerationalComparisonQueryDto = z.infer<
  typeof generationalComparisonQuerySchema
>;

export type GenerationalPoint = {
  academicYearId: string;
  year: number;
  studentsCount: number;
  averageAchievement: number | null; // % logro 0..100
  passingRate: number | null; // % alumnos sobre passing_grade, 0..100
  performanceDistribution: PerformanceDistributionBucket[];
};

export type GenerationalComparisonResponse = {
  gradeId: string;
  gradeName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  nodeId: string | null;
  nodeName: string | null;
  series: GenerationalPoint[]; // ordenada por año ascendente
};

// ── H6.6 — Progresión a lo largo del año ─────────────────────────────────────
// Serie temporal de % logro a través de las evaluaciones de un período. El scope
// determina la entidad medida: un alumno, un curso o una habilidad.

export const PROGRESSION_SCOPES = ['student', 'class', 'skill'] as const;
export type ProgressionScope = (typeof PROGRESSION_SCOPES)[number];

export const progressionQuerySchema = z
  .object({
    scope: z.enum(PROGRESSION_SCOPES),
    studentId: z.string().uuid().optional(),
    classGroupId: z.string().uuid().optional(),
    nodeId: z.string().uuid().optional(),
    subjectId: z.string().uuid().optional(),
    academicYearId: z.string().uuid().optional(),
  })
  .refine(
    (q) =>
      (q.scope === 'student' && !!q.studentId) ||
      (q.scope === 'class' && !!q.classGroupId) ||
      (q.scope === 'skill' && !!q.nodeId),
    {
      message:
        'scope=student requiere studentId; scope=class requiere classGroupId; scope=skill requiere nodeId',
    },
  );
export type ProgressionQueryDto = z.infer<typeof progressionQuerySchema>;

export type ProgressionPoint = {
  assessmentId: string;
  assessmentName: string | null;
  instrumentName: string;
  administeredAt: string | Date | null;
  achievement: number | null; // % logro 0..100
  performanceLevel: PerformanceLevel | null;
};

export type ProgressionResponse = {
  scope: ProgressionScope;
  subjectId: string | null;
  entityId: string; // studentId | classGroupId | nodeId según scope
  entityLabel: string | null;
  points: ProgressionPoint[]; // ordenada por administeredAt ascendente
};
