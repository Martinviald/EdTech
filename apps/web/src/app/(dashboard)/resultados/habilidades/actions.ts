'use server';

import { apiGet } from '@/lib/api';
import type {
  DashboardSkillBreakdownResponse,
  ItemMatrixResponse,
  MatrixQuestionColumn,
  SkillBreakdownDimension,
} from '@soe/types';

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

// ─────────────────────────────────────────────────────────────────────────────
// Drill-down jerárquico — un peldaño del desglose de un nodo por dimensión
// (Asignatura → Nivel → Curso → Evaluación). El scoping/org_id los resuelve el
// backend desde el token. Las claves de filtro (subject/grade/classGroup/…)
// arrastran el contexto acumulado del drill-down.
// ─────────────────────────────────────────────────────────────────────────────

/** Restricciones acumuladas + filtros base que arrastra cada peldaño. */
export type SkillBreakdownConstraints = {
  subjectId?: string;
  gradeId?: string;
  classGroupId?: string;
  studentId?: string;
  academicYearId?: string;
  instrumentType?: string;
  assessmentId?: string;
};

export type SkillBreakdownResult =
  | { ok: true; data: DashboardSkillBreakdownResponse }
  | { ok: false; message: string };

export async function fetchSkillBreakdown(input: {
  nodeId: string;
  groupBy: SkillBreakdownDimension;
  constraints: SkillBreakdownConstraints;
}): Promise<SkillBreakdownResult> {
  try {
    const params = new URLSearchParams({ nodeId: input.nodeId, groupBy: input.groupBy });
    for (const [key, value] of Object.entries(input.constraints)) {
      if (value) params.set(key, value);
    }
    const data = await apiGet<DashboardSkillBreakdownResponse>(
      `/dashboards/skills/breakdown?${params.toString()}`,
    );
    return { ok: true, data };
  } catch (e) {
    const err = e as ApiError;
    return {
      ok: false,
      message: err.message ?? 'No se pudo cargar el desglose de este logro.',
    };
  }
}
