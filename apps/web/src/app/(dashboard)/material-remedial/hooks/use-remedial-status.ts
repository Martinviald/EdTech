'use client';

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RemedialMaterialModel, RemedialStatus } from '@soe/types';
import { apiClientGet } from '@/lib/api-client';

const POLL_INTERVAL_MS = 3000;
const MAX_ATTEMPTS = 100;

function isPolling(status: RemedialStatus | undefined): boolean {
  return status === 'pending' || status === 'processing';
}

export const remedialStatusKeys = {
  detail: (materialId: string) => ['remedial-material', materialId, 'status'] as const,
};

export function useRemedialStatus(materialId: string, initialStatus: RemedialStatus) {
  const attempts = useRef(0);

  return useQuery({
    queryKey: remedialStatusKeys.detail(materialId),
    queryFn: () => {
      attempts.current += 1;
      return apiClientGet<RemedialMaterialModel>(`/remedial/${materialId}`);
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status ?? initialStatus;
      if (!isPolling(status)) return false;
      return attempts.current < MAX_ATTEMPTS ? POLL_INTERVAL_MS : false;
    },
  });
}
