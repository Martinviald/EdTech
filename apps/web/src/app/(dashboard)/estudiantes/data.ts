import { cache } from 'react';

import { apiGet } from '@/lib/api';
import type { StudentPanoramaResponse } from '@soe/types';

/**
 * Panorama 360 de un alumno (T2-20). Cacheado por-request para deduplicar si el
 * shell y una sección lo piden a la vez. El scoping por curso lo aplica el backend.
 */
export const getStudentPanorama = cache((studentId: string) =>
  apiGet<StudentPanoramaResponse>(`/students/${studentId}/panorama`),
);
