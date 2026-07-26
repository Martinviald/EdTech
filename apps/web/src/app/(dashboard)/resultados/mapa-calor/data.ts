import { cache } from 'react';

import { apiGet } from '@/lib/api';
import type { HeatmapResponse } from '@soe/types';

export const getHeatmap = cache((query: string) =>
  apiGet<HeatmapResponse>(`/heatmap${query}`),
);
