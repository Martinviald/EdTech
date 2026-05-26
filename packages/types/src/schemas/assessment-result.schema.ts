import { z } from 'zod';
import { PERFORMANCE_LEVELS, type PerformanceLevel } from '../enums';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export const calculateAssessmentResultsRequestSchema = z.object({
  // Si se omite, usa la grading scale del instrumento; si tampoco existe,
  // usa la escala default de la org o linear_chilean genérica.
  gradingScaleId: z.string().uuid().optional(),
  // Permite forzar recálculo aún si ya hay resultados.
  force: z.boolean().default(false),
});
export type CalculateAssessmentResultsRequestDto = z.infer<
  typeof calculateAssessmentResultsRequestSchema
>;

export const listAssessmentResultsQuerySchema = z.object({
  classGroupId: z.string().uuid().optional(),
  performanceLevel: z.enum(PERFORMANCE_LEVELS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListAssessmentResultsQueryDto = z.infer<typeof listAssessmentResultsQuerySchema>;

// ── Response Models ──────────────────────────────────────────────────────────

export type AssessmentResultModel = {
  id: string;
  assessmentId: string;
  studentId: string;
  studentRut: string;
  studentFullName: string;
  totalScore: string | null;
  maxScore: string | null;
  percentage: string | null; // 0..100 como decimal string
  grade: string | null; // nota
  performanceLevel: PerformanceLevel | null;
  isComplete: boolean;
  completedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type SkillResultModel = {
  id: string;
  assessmentId: string;
  studentId: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  correctCount: number;
  totalCount: number;
  percentage: string | null; // 0..100
  performanceLevel: PerformanceLevel | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type AssessmentResultsListResponse = {
  data: AssessmentResultModel[];
  total: number;
  page: number;
  limit: number;
};

export type SkillResultsListResponse = {
  data: SkillResultModel[];
  total: number;
  page: number;
  limit: number;
};

export type CalculateAssessmentResultsResponse = {
  assessmentId: string;
  resultsCreated: number;
  resultsUpdated: number;
  skillResultsCreated: number;
  skillResultsUpdated: number;
  studentsProcessed: number;
};

export type StudentResultDetail = {
  result: AssessmentResultModel;
  skillResults: SkillResultModel[];
  responses: Array<{
    itemId: string;
    itemPosition: number;
    rawAnswer: string | null;
    isCorrect: boolean | null;
    rawScore: string | null;
    finalScore: string | null;
    maxScore: string;
  }>;
};
