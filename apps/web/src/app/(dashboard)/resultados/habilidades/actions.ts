'use server';

import { apiGet } from '@/lib/api';
import type { ItemMatrixResponse, MatrixQuestionColumn } from '@soe/types';

// ─────────────────────────────────────────────────────────────────────────────
// TKT-10 — Drill-down "habilidad → preguntas asociadas".
//
// Reutiliza el endpoint de la matriz de ítems (H6.11) filtrado por `nodeId`: la
// matriz devuelve exactamente las columnas (preguntas) etiquetadas con ese nodo,
// con su % de logro (`correctRate`). Sólo interesan las columnas, así que se pide
// `limit=1` para minimizar la nómina de alumnos (el `correctRate` se calcula
// sobre TODA la población del scope, no sobre la página). El scoping por rol y el
// org_id los resuelve el backend desde el token de sesión.
// ─────────────────────────────────────────────────────────────────────────────

type ApiError = Error & { status?: number; details?: unknown };

export type NodeQuestionsResult =
  | { ok: true; questions: MatrixQuestionColumn[]; studentsTotal: number }
  | { ok: false; message: string };

export async function fetchNodeQuestions(input: {
  assessmentId: string;
  nodeId: string;
  classGroupId?: string;
}): Promise<NodeQuestionsResult> {
  try {
    const params = new URLSearchParams({
      assessmentId: input.assessmentId,
      nodeId: input.nodeId,
      limit: '1',
    });
    if (input.classGroupId) params.set('classGroupId', input.classGroupId);
    const data = await apiGet<ItemMatrixResponse>(`/item-analysis/matrix?${params.toString()}`);
    return { ok: true, questions: data.questions, studentsTotal: data.students.total };
  } catch (e) {
    const err = e as ApiError;
    return {
      ok: false,
      message: err.message ?? 'No se pudieron cargar las preguntas asociadas.',
    };
  }
}
