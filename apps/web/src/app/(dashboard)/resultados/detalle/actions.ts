'use server';

import { apiGet } from '@/lib/api';
import type { QuestionAnalysisResponse } from '@soe/types';

// ─────────────────────────────────────────────────────────────────────────────
// Enfoque de fetch del panel de detalle (H6.12):
// El <QuestionDetailPanel> es un componente client (modal/sheet) que necesita
// cargar la distribución de respuestas de una pregunta bajo demanda (al hacer
// click en una columna de la matriz). Como `apiGet` es server-only, exponemos
// la carga vía esta Server Action. El componente client la invoca y recibe el
// `QuestionAnalysisResponse` ya tipado (o un error legible). El scoping por rol
// y el org_id los resuelve el backend desde el token de sesión.
// ─────────────────────────────────────────────────────────────────────────────

type ApiError = Error & { status?: number; details?: unknown };

export type QuestionAnalysisActionResult =
  | { ok: true; data: QuestionAnalysisResponse }
  | { ok: false; message: string };

export async function fetchQuestionAnalysis(input: {
  itemId: string;
  assessmentId?: string;
  classGroupId?: string;
}): Promise<QuestionAnalysisActionResult> {
  try {
    const params = new URLSearchParams();
    if (input.assessmentId) params.set('assessmentId', input.assessmentId);
    if (input.classGroupId) params.set('classGroupId', input.classGroupId);
    const qs = params.toString();
    const data = await apiGet<QuestionAnalysisResponse>(
      `/item-analysis/questions/${input.itemId}${qs ? `?${qs}` : ''}`,
    );
    return { ok: true, data };
  } catch (e) {
    const err = e as ApiError;
    return {
      ok: false,
      message: err.message ?? 'No se pudo cargar el análisis de la pregunta.',
    };
  }
}
