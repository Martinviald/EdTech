'use server';

import {
  generateAnalysisSchema,
  type AiAnalysisModel,
  type AiAnalysisStatus,
} from '@soe/types';
import { apiGet, apiPost } from '@/lib/api';

/**
 * Gatilla la generación (o regeneración con `force`) del informe IA de una
 * evaluación. El backend crea/reutiliza el registro y encola la ejecución async;
 * responde `{ analysisId, status }` para que el cliente haga polling con
 * `GET /:id`. La autorización efectiva la aplica el guard del endpoint
 * (`AI_ANALYSIS_GENERATOR_ROLES`).
 */
export async function generateAssessmentAnalysis(input: {
  assessmentId: string;
  classGroupId?: string;
  audience?: 'general' | 'director' | 'teacher';
  force?: boolean;
}): Promise<{ analysisId: string; status: AiAnalysisModel['status'] }> {
  const dto = generateAnalysisSchema.parse({
    analysisType: 'assessment_insights',
    audience: input.audience ?? 'general',
    classGroupId: input.classGroupId,
    force: input.force ?? false,
  });

  return apiPost<{ analysisId: string; status: AiAnalysisModel['status'] }>(
    `/ai-analysis/assessments/${input.assessmentId}/generate`,
    dto,
  );
}

/**
 * Reconsulta el estado de un análisis (polling desde el cliente). Solo devuelve
 * el `status`: el render del output lo hace el Server Component tras `refresh`.
 */
export async function pollAnalysisStatus(
  analysisId: string,
): Promise<{ status: AiAnalysisStatus }> {
  const analysis = await apiGet<AiAnalysisModel>(`/ai-analysis/${analysisId}`);
  return { status: analysis.status };
}
