import { z } from 'zod';

// Contratos del motor de análisis IA (F2 S0 — H19.23). El output rico por tipo de
// análisis (AssessmentInsightsOutput, etc.) se define en S1; aquí van los DTOs del
// job y el Model de respuesta del registro.

export const aiAnalysisStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed']);
export type AiAnalysisStatus = z.infer<typeof aiAnalysisStatusSchema>;

export const aiAnalysisAudienceSchema = z.enum(['general', 'director', 'teacher']);
export type AiAnalysisAudience = z.infer<typeof aiAnalysisAudienceSchema>;

export const generateAnalysisSchema = z.object({
  analysisType: z.string().min(1).default('assessment_insights'),
  audience: aiAnalysisAudienceSchema.default('general'),
  classGroupId: z.string().uuid().optional(),
  force: z.boolean().default(false), // ignora la caché por input_hash
});
export type GenerateAnalysisDto = z.infer<typeof generateAnalysisSchema>;

export type AiAnalysisModel = {
  id: string;
  orgId: string;
  assessmentId: string | null;
  analysisType: string;
  audience: string;
  status: AiAnalysisStatus;
  model: string | null;
  promptVersion: string | null;
  output: Record<string, unknown> | null;
  costUsd: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};
