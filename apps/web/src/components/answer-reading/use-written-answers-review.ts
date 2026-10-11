'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ReviewMode,
  ReviewQueuePage,
  ReviewQueueSummary,
  SubmitReviewDto,
  SubmitReviewResult,
} from '@soe/types';
import { apiClientGet, apiClientPost } from '@/lib/api-client';

/** Alcance de la cola: un lote (asistente de revisión) o una evaluación (pestaña del hub). */
export type WrittenAnswersScope = { batchId: string } | { assessmentId: string };

export interface WrittenAnswersFilters {
  mode: ReviewMode;
  itemId: string | null;
  includeAudit: boolean;
  page: number;
}

const SUMMARY_POLL_MS = 5_000;
const QUEUE_POLL_MS = 10_000;
export const QUEUE_PAGE_SIZE = 50;

function scopeParams(scope: WrittenAnswersScope): URLSearchParams {
  const params = new URLSearchParams();
  if ('batchId' in scope) params.set('batchId', scope.batchId);
  else params.set('assessmentId', scope.assessmentId);
  return params;
}

function scopeId(scope: WrittenAnswersScope): string {
  return 'batchId' in scope ? `batch:${scope.batchId}` : `assessment:${scope.assessmentId}`;
}

export const writtenAnswersKeys = {
  all: (scope: WrittenAnswersScope) => ['answer-reading', scopeId(scope)] as const,
  summary: (scope: WrittenAnswersScope) => [...writtenAnswersKeys.all(scope), 'summary'] as const,
  queue: (scope: WrittenAnswersScope, filters: WrittenAnswersFilters) =>
    [...writtenAnswersKeys.all(scope), 'queue', filters] as const,
};

export function hasWrittenAnswers(summary: ReviewQueueSummary | undefined): boolean {
  if (!summary) return false;
  return (
    summary.byItem.length > 0 ||
    summary.pendingReading +
      summary.pendingGrading +
      summary.pendingAudit +
      summary.autoAccepted +
      summary.inProgress >
      0
  );
}

export function pendingWrittenAnswers(summary: ReviewQueueSummary | undefined): number {
  if (!summary) return 0;
  return summary.pendingReading + summary.pendingGrading;
}

export function useWrittenAnswersSummary(scope: WrittenAnswersScope, enabled = true) {
  return useQuery({
    queryKey: writtenAnswersKeys.summary(scope),
    queryFn: () =>
      apiClientGet<ReviewQueueSummary>(
        `/answer-reading/queue/summary?${scopeParams(scope).toString()}`,
      ),
    enabled,
    refetchInterval: (query) => ((query.state.data?.inProgress ?? 0) > 0 ? SUMMARY_POLL_MS : false),
  });
}

export function useWrittenAnswersQueue(
  scope: WrittenAnswersScope,
  filters: WrittenAnswersFilters,
  options: { enabled: boolean; readingInProgress: boolean },
) {
  return useQuery({
    queryKey: writtenAnswersKeys.queue(scope, filters),
    queryFn: () => {
      const params = scopeParams(scope);
      params.set('mode', filters.mode);
      if (filters.itemId) params.set('itemId', filters.itemId);
      if (filters.includeAudit) params.set('includeAudit', 'true');
      params.set('page', String(filters.page));
      params.set('pageSize', String(QUEUE_PAGE_SIZE));
      return apiClientGet<ReviewQueuePage>(`/answer-reading/queue?${params.toString()}`);
    },
    enabled: options.enabled,
    refetchInterval: options.readingInProgress ? QUEUE_POLL_MS : false,
  });
}

export function useSubmitReview(scope: WrittenAnswersScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: SubmitReviewDto) =>
      apiClientPost<SubmitReviewResult>('/answer-reading/reviews', dto),
    onSettled: () => queryClient.invalidateQueries({ queryKey: writtenAnswersKeys.all(scope) }),
  });
}

/**
 * Deshacer es por revisión (`POST /reviews/:id/undo`): una acción de grupo crea
 * una revisión por respuesta, así que se deshacen todas en orden.
 */
export function useUndoReview(scope: WrittenAnswersScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reviewIds: readonly string[]) => {
      const results: SubmitReviewResult[] = [];
      for (const reviewId of reviewIds) {
        results.push(
          await apiClientPost<SubmitReviewResult>(`/answer-reading/reviews/${reviewId}/undo`, {}),
        );
      }
      return results;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: writtenAnswersKeys.all(scope) }),
  });
}
