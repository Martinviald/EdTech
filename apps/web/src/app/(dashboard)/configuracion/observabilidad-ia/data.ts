import { cache } from 'react';

import { apiGet } from '@/lib/api';
import type {
  AiBudgetStatus,
  AiCostTimeseriesResponse,
  AiObservabilitySummary,
} from '@soe/types';

export const getAiObservabilitySummary = cache(() =>
  apiGet<AiObservabilitySummary>('/ai-observability/summary'),
);

export const getAiBudget = cache(() => apiGet<AiBudgetStatus>('/ai-observability/budget'));

export const getAiCostTimeseries = cache(() =>
  apiGet<AiCostTimeseriesResponse>('/ai-observability/timeseries'),
);
