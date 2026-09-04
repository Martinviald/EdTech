'use client';

import { useMutation } from '@tanstack/react-query';
import type { CaptureTransport } from '@soe/types';

export const assessCaptureKeys = {
  mutation: () => ['sheet-scan-assess-capture'] as const,
};

export function useAssessCapture(assess: CaptureTransport['assess']) {
  return useMutation({
    mutationKey: assessCaptureKeys.mutation(),
    mutationFn: (imageBase64: string) => assess(imageBase64),
  });
}
