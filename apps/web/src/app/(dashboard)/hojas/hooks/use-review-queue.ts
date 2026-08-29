'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BatchStatusModel,
  ConfirmBatchResponse,
  ReviewMarkModel,
  ReviewQueueModel,
  ReviewScanModel,
} from '@soe/types';
import { apiClientGet, apiClientPatch, apiClientPost } from '@/lib/api-client';
import { batchStatusKeys } from './use-batch-status';

export const reviewQueueKeys = {
  detail: (batchId: string) => ['sheet-scan-batch', batchId, 'review'] as const,
};

const OPTIMISTIC_REVIEWER = 'optimistic';

/** Una marca cuenta como resuelta cuando un humano la tocó — `reviewedValue: null` es "en blanco", no "pendiente" (§8.3). */
export function isMarkResolved(mark: ReviewMarkModel): boolean {
  return mark.reviewedById !== null;
}

export function useReviewQueue(batchId: string, enabled: boolean) {
  return useQuery({
    queryKey: reviewQueueKeys.detail(batchId),
    queryFn: () => apiClientGet<ReviewQueueModel>(`/sheet-scan-batches/${batchId}/review`),
    enabled,
  });
}

/**
 * PATCH optimista: la cola local se actualiza y el panel avanza a la marca
 * siguiente sin esperar la red — la latencia no puede frenar el ritmo de
 * revisión (C16). El toast de error lo pone el `MutationCache` global; acá
 * sólo se revierte el estado local.
 */
export function useResolveMark(batchId: string) {
  const queryClient = useQueryClient();
  const queueKey = reviewQueueKeys.detail(batchId);

  return useMutation({
    mutationFn: ({ markId, reviewedValue }: { markId: string; reviewedValue: string | null }) =>
      apiClientPatch<ReviewMarkModel>(`/sheet-scan-marks/${markId}`, { reviewedValue }),
    onMutate: async ({ markId, reviewedValue }) => {
      await queryClient.cancelQueries({ queryKey: queueKey });
      const previous = queryClient.getQueryData<ReviewQueueModel>(queueKey);
      queryClient.setQueryData<ReviewQueueModel>(queueKey, (old) =>
        old
          ? {
              ...old,
              ambiguousMarks: old.ambiguousMarks.map((mark) =>
                mark.markId === markId
                  ? { ...mark, reviewedValue, reviewedById: OPTIMISTIC_REVIEWER }
                  : mark,
              ),
            }
          : old,
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queueKey, context.previous);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ReviewQueueModel>(queueKey, (old) =>
        old
          ? {
              ...old,
              ambiguousMarks: old.ambiguousMarks.map((mark) =>
                mark.markId === updated.markId ? { ...mark, ...updated } : mark,
              ),
            }
          : old,
      );
      void queryClient.invalidateQueries({ queryKey: batchStatusKeys.detail(batchId) });
    },
  });
}

export function useAssignIdentity(batchId: string) {
  const queryClient = useQueryClient();
  const queueKey = reviewQueueKeys.detail(batchId);

  return useMutation({
    mutationFn: ({ scanId, studentId }: { scanId: string; studentId: string }) =>
      apiClientPatch<ReviewScanModel>(`/sheet-scans/${scanId}/identity`, { studentId }),
    onSuccess: (updated) => {
      queryClient.setQueryData<ReviewQueueModel>(queueKey, (old) =>
        old
          ? {
              ...old,
              identityUnresolved: old.identityUnresolved.filter(
                (scan) => scan.scanId !== updated.scanId,
              ),
            }
          : old,
      );
      void queryClient.invalidateQueries({ queryKey: batchStatusKeys.detail(batchId) });
    },
  });
}

export function useDiscardScan(batchId: string) {
  const queryClient = useQueryClient();
  const queueKey = reviewQueueKeys.detail(batchId);

  return useMutation({
    mutationFn: ({ scanId, reason }: { scanId: string; reason: string }) =>
      apiClientPatch<ReviewScanModel>(`/sheet-scans/${scanId}/discard`, { reason }),
    onSuccess: (updated) => {
      queryClient.setQueryData<ReviewQueueModel>(queueKey, (old) =>
        old
          ? {
              ...old,
              qualityRejected: old.qualityRejected.filter((scan) => scan.scanId !== updated.scanId),
              identityUnresolved: old.identityUnresolved.filter(
                (scan) => scan.scanId !== updated.scanId,
              ),
            }
          : old,
      );
      void queryClient.invalidateQueries({ queryKey: batchStatusKeys.detail(batchId) });
    },
  });
}

export function useConfirmBatch(batchId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiClientPost<ConfirmBatchResponse>(`/sheet-scan-batches/${batchId}/confirm`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: batchStatusKeys.detail(batchId) });
      void queryClient.invalidateQueries({ queryKey: reviewQueueKeys.detail(batchId) });
    },
  });
}

export function useRetryBatch(batchId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClientPost<BatchStatusModel>(`/sheet-scan-batches/${batchId}/retry`, {}),
    onSuccess: (updated) => {
      queryClient.setQueryData<BatchStatusModel>(batchStatusKeys.detail(batchId), updated);
    },
  });
}
