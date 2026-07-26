import { cache } from 'react';

import { apiGet } from '@/lib/api';
import type { DashboardPerformanceResponse } from '@soe/types';

export const getDashboardPerformance = cache((query: string) =>
  apiGet<DashboardPerformanceResponse>(`/dashboards/performance${query}`),
);
