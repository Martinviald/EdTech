import { cache } from 'react';

import { apiGet } from '@/lib/api';
import type { ComparableTrajectoryResponse } from '@soe/types';

export const getComparableTrajectory = cache((query: string) =>
  apiGet<ComparableTrajectoryResponse>(`/analytics/comparable-trajectory${query}`),
);
