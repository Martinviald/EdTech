'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RubricApprovalDto, RubricApprovalResult, RubricReviewDetail } from '@soe/types';
import { apiClientGet, apiClientPost } from '@/lib/api-client';
import { writtenAnswersKeys, type WrittenAnswersScope } from './use-written-answers-review';

/**
 * Las claves cuelgan de `writtenAnswersKeys.all(scope)`: así el deshacer de F8
 * (que invalida todo el alcance) también refresca la aprobación vigente.
 */
export const rubricReviewKeys = {
  detail: (scope: WrittenAnswersScope, decisionId: string) =>
    [...writtenAnswersKeys.all(scope), 'rubric', decisionId] as const,
};

export function useRubricReviewDetail(scope: WrittenAnswersScope, decisionId: string | null) {
  return useQuery({
    queryKey: rubricReviewKeys.detail(scope, decisionId ?? 'none'),
    queryFn: () =>
      apiClientGet<RubricReviewDetail>(`/answer-reading/rubric-queue/${decisionId as string}`),
    enabled: decisionId !== null,
  });
}

/** Aprueba un nivel de rúbrica para una respuesta (`POST /answer-reading/rubric-approvals`). */
export function useApproveRubricLevel(scope: WrittenAnswersScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: RubricApprovalDto) =>
      apiClientPost<RubricApprovalResult>('/answer-reading/rubric-approvals', dto),
    onSettled: () => queryClient.invalidateQueries({ queryKey: writtenAnswersKeys.all(scope) }),
  });
}
