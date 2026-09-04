'use client';

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BatchStatusModel, SheetScanBatchStatus } from '@soe/types';
import { apiClientGet } from '@/lib/api-client';

const POLL_INTERVAL_MS = 3000;
const MAX_ATTEMPTS = 200;

function isPolling(status: SheetScanBatchStatus | undefined): boolean {
  return status === 'pending' || status === 'processing';
}

export const batchStatusKeys = {
  detail: (batchId: string) => ['sheet-scan-batch', batchId, 'status'] as const,
};

/**
 * Polling del lote (contrato §3): cada 3 s mientras `pending`/`processing`,
 * se detiene en los estados terminales (`needs_review`/`confirmed`/`failed`/
 * `rejected`). Mismo patrón que `use-remedial-status`.
 */
export function useBatchStatus(batchId: string, initialBatch: BatchStatusModel) {
  const attempts = useRef(0);

  return useQuery({
    queryKey: batchStatusKeys.detail(batchId),
    queryFn: () => {
      attempts.current += 1;
      return apiClientGet<BatchStatusModel>(`/sheet-scan-batches/${batchId}`);
    },
    initialData: initialBatch,
    refetchInterval: (query) => {
      const status = query.state.data?.status ?? initialBatch.status;
      if (!isPolling(status)) return false;
      return attempts.current < MAX_ATTEMPTS ? POLL_INTERVAL_MS : false;
    },
  });
}
