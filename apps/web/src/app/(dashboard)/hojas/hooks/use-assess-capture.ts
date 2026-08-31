'use client';

import { useMutation } from '@tanstack/react-query';
import type { AssessCaptureDto, AssessCaptureResponse } from '@soe/types';
import { apiClientPost } from '@/lib/api-client';

export const assessCaptureKeys = {
  mutation: () => ['sheet-scan-assess-capture'] as const,
};

export function useAssessCapture() {
  return useMutation({
    mutationKey: assessCaptureKeys.mutation(),
    mutationFn: (dto: AssessCaptureDto) =>
      apiClientPost<AssessCaptureResponse>('/sheet-scan-batches/assess-capture', dto),
  });
}
