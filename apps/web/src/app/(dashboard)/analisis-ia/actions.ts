'use server';

import {
  generateAnalysisSchema,
  generateItemInsightSchema,
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
 * Gatilla la generación (o regeneración con `force`) del análisis IA por-pregunta
 * (H20.8). El backend crea/reutiliza el registro y encola la ejecución async;
 * responde `{ analysisId, status }` para que el cliente haga polling con
 * `GET /:id` y obtenga el `ItemInsightOutput` cuando `completed`. La autorización
 * efectiva la aplica el guard del endpoint (`AI_ANALYSIS_GENERATOR_ROLES`).
 */
export async function generateItemInsight(input: {
  itemId: string;
  assessmentId: string;
  classGroupId?: string;
  audience?: 'general' | 'director' | 'teacher';
  force?: boolean;
}): Promise<{ analysisId: string; status: AiAnalysisStatus }> {
  const dto = generateItemInsightSchema.parse({
    assessmentId: input.assessmentId,
    audience: input.audience ?? 'general',
    classGroupId: input.classGroupId,
    force: input.force ?? false,
  });

  return apiPost<{ analysisId: string; status: AiAnalysisStatus }>(
    `/ai-analysis/items/${input.itemId}/generate`,
    dto,
  );
}

/**
 * Reconsulta el análisis por-pregunta completo (polling desde el cliente). A
 * diferencia del informe de evaluación —que lo re-renderiza el Server Component—,
 * el drill-down vive en un modal cliente, así que devolvemos el `AiAnalysisModel`
 * íntegro para que el cliente valide `output` con `itemInsightOutputSchema`.
 */
export async function fetchItemInsight(
  analysisId: string,
): Promise<AiAnalysisModel> {
  return apiGet<AiAnalysisModel>(`/ai-analysis/${analysisId}`);
}
