import { cache } from 'react';
import { apiGet } from '@/lib/api';
import type { AssessmentReportResponse } from '@soe/types';

/** Primer valor de un searchParam (Next entrega `string | string[]`). */
export function pickParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

/**
 * Ficha de la evaluación SIN acotar a un curso. `cache()` la comparte entre el
 * layout del hub y las pestañas dentro del mismo request (una sola llamada).
 */
export const getAssessmentReportMeta = cache((assessmentId: string) =>
  apiGet<AssessmentReportResponse>(`/analytics/assessment-report?assessmentId=${assessmentId}`),
);

/**
 * Cursos que rindieron la evaluación, ya intersectados con el alcance del
 * usuario por el backend (un profesor sólo ve los suyos). Es la fuente del
 * selector de curso del hub: sin acotar por `classGroupId`, el listado completo.
 */
export async function getAssessmentCourses(
  assessmentId: string,
): Promise<{ id: string; name: string }[]> {
  try {
    const report = await getAssessmentReportMeta(assessmentId);
    return report.meta.classGroups;
  } catch {
    return [];
  }
}
