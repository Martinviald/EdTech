import { cache } from 'react';

import { apiGet } from '@/lib/api';
import type {
  BenchmarkInstrumentListResponse,
  BenchmarkComparisonResponse,
} from '@soe/types';

export const getBenchmarkInstruments = cache(() =>
  apiGet<BenchmarkInstrumentListResponse>('/benchmarking/instruments'),
);

export const getBenchmarkComparison = cache((query: string) =>
  apiGet<BenchmarkComparisonResponse>(`/benchmarking/comparison?${query}`),
);
