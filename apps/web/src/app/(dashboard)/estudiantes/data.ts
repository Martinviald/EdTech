import { cache } from 'react';

import { apiGet } from '@/lib/api';
import type {
  StudentComparisonsQueryDto,
  StudentComparisonsResponse,
  StudentPanoramaQueryDto,
  StudentPanoramaResponse,
} from '@soe/types';

type StudentDashboardQuery = StudentPanoramaQueryDto & StudentComparisonsQueryDto;

function buildQuery(query: StudentDashboardQuery): string {
  const params = new URLSearchParams();
  if (query.subjectId) params.set('subjectId', query.subjectId);
  if (query.instrumentType) params.set('instrumentType', query.instrumentType);
  if (query.applicationPeriod) params.set('applicationPeriod', query.applicationPeriod);
  if (query.year !== undefined) params.set('year', String(query.year));
  if (query.allYears) params.set('allYears', 'true');
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Panorama 360 de un alumno (T2-20 · #2B). Cacheado por-request para deduplicar si
 * el shell y una sección lo piden a la vez. El scoping por curso lo aplica el
 * backend; los filtros del zoom viajan como query.
 */
export const getStudentPanorama = cache((studentId: string, query: StudentPanoramaQueryDto = {}) =>
  apiGet<StudentPanoramaResponse>(`/students/${studentId}/panorama${buildQuery(query)}`),
);

/**
 * Comparativas 360 por asignatura (F2 · B2): el alumno contra su curso, su nivel y
 * las generaciones anteriores. Comparte los filtros del Panorama, así que viaja con
 * la misma query. Cacheado por-request y pedido en su propia sección streameada,
 * separado del Panorama para no bloquear el shell con las agregaciones de cohortes.
 */
export const getStudentComparisons = cache(
  (studentId: string, query: StudentComparisonsQueryDto = {}) =>
    apiGet<StudentComparisonsResponse>(`/students/${studentId}/comparisons${buildQuery(query)}`),
);
