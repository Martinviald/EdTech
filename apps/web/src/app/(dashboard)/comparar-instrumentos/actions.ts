'use server';

import {
  compareInstrumentsSchema,
  type AiAnalysisModel,
  type ComparableAssessment,
} from '@soe/types';
import { apiGet, apiPost } from '@/lib/api';

/**
 * Lista las evaluaciones candidatas (con resultados) para comparar, con metadatos
 * de su instrumento. La autorización efectiva la aplica el guard del endpoint
 * (`AI_ANALYSIS_GENERATOR_ROLES`).
 */
export async function fetchComparableAssessments(): Promise<ComparableAssessment[]> {
  return apiGet<ComparableAssessment[]>('/ai-analysis/compare-instruments/candidates');
}

/**
 * Gatilla el diagnóstico IA de la variación entre dos instrumentos comparables.
 * El backend valida comparabilidad, crea/reutiliza el registro y encola la
 * ejecución async; responde `{ analysisId, status }` para hacer polling.
 */
export async function startInstrumentComparison(input: {
  baseAssessmentId: string;
  comparisonAssessmentId: string;
  audience?: 'general' | 'director' | 'teacher';
  force?: boolean;
}): Promise<{ analysisId: string; status: AiAnalysisModel['status'] }> {
  const dto = compareInstrumentsSchema.parse({
    baseAssessmentId: input.baseAssessmentId,
    comparisonAssessmentId: input.comparisonAssessmentId,
    audience: input.audience ?? 'general',
    force: input.force ?? false,
  });

  return apiPost<{ analysisId: string; status: AiAnalysisModel['status'] }>(
    '/ai-analysis/compare-instruments',
    dto,
  );
}

/**
 * Reconsulta el registro completo de la comparación (polling desde el cliente).
 * Devuelve el `AiAnalysisModel` íntegro para que el cliente valide `output` con
 * `instrumentComparisonOutputSchema` cuando pasa a `completed`.
 */
export async function pollInstrumentComparison(analysisId: string): Promise<AiAnalysisModel> {
  return apiGet<AiAnalysisModel>(`/ai-analysis/${analysisId}`);
}
