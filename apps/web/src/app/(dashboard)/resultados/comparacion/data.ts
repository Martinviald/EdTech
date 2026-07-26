import { cache } from 'react';

import { apiGet } from '@/lib/api';
import type { GenerationalComparisonResponse } from '@soe/types';

export const getGenerationalComparison = cache((query: string) =>
  apiGet<GenerationalComparisonResponse>(`/analytics/generational${query}`),
);
