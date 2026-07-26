import { cache } from 'react';

import { apiGet } from '@/lib/api';
import type { ProgressionResponse } from '@soe/types';

export const getProgression = cache((query: string) =>
  apiGet<ProgressionResponse>(`/analytics/progression${query}`),
);
