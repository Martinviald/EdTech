import { cache } from 'react';

import { apiGet } from '@/lib/api';
import type { AssessmentListResponse, DashboardFilterOptionsResponse } from '@soe/types';

export const getEvaluacionesFilters = cache((query: string) =>
  apiGet<DashboardFilterOptionsResponse>(`/dashboards/filters${query}`),
);

export const getEvaluacionesAssessments = cache((query: string) =>
  apiGet<AssessmentListResponse>(`/item-analysis/assessments${query}`),
);
