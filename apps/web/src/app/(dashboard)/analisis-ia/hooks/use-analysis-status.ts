'use client';

import { useQuery } from '@tanstack/react-query';
import type { AiAnalysisModel, AiAnalysisStatus } from '@soe/types';
import { apiClientGet } from '@/lib/api-client';

const POLL_INTERVAL_MS = 3000;

function isPolling(status: AiAnalysisStatus | undefined): boolean {
  return status === 'pending' || status === 'processing';
}

export const analysisStatusKeys = {
  detail: (analysisId: string) => ['ai-analysis', analysisId, 'status'] as const,
};

export function useAnalysisStatus(analysisId: string, initialStatus: AiAnalysisStatus) {
  return useQuery({
    queryKey: analysisStatusKeys.detail(analysisId),
    queryFn: () => apiClientGet<AiAnalysisModel>(`/ai-analysis/${analysisId}`),
    refetchInterval: (query) =>
      isPolling(query.state.data?.status ?? initialStatus) ? POLL_INTERVAL_MS : false,
  });
}
