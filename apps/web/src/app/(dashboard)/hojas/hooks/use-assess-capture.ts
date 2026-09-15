'use client';

import { useMutation } from '@tanstack/react-query';
import type { CaptureTransport } from '@soe/types';

export const assessCaptureKeys = {
  mutation: () => ['sheet-scan-assess-capture'] as const,
};

/** `signal` es opcional: sólo la captura móvil cancela evaluaciones en curso. */
export type AssessCaptureVariables = { imageBase64: string; signal?: AbortSignal };

export function useAssessCapture(assess: CaptureTransport['assess']) {
  return useMutation({
    mutationKey: assessCaptureKeys.mutation(),
    mutationFn: ({ imageBase64, signal }: AssessCaptureVariables) => assess(imageBase64, signal),
  });
}
