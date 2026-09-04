'use client';

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CaptureSessionStatus, CaptureSessionStatusModel } from '@soe/types';
import { apiClientGet } from '@/lib/api-client';

const POLL_INTERVAL_MS = 2500;
const MAX_ATTEMPTS = 400;

function isPolling(status: CaptureSessionStatus | undefined): boolean {
  return status === undefined || status === 'pending' || status === 'active';
}

export const captureSessionKeys = {
  detail: (sessionId: string) => ['capture-session', sessionId, 'status'] as const,
};

/**
 * Polling del PC (CD-23): cada 2,5 s mientras la sesión siga `pending`/`active`,
 * se detiene en los estados terminales (`closed`/`revoked`/`expired`). Mismo
 * patrón que `use-batch-status`/`use-remedial-status`.
 */
export function useCaptureSession(sessionId: string | null) {
  const attempts = useRef(0);

  return useQuery({
    queryKey: captureSessionKeys.detail(sessionId ?? 'none'),
    queryFn: () => {
      attempts.current += 1;
      return apiClientGet<CaptureSessionStatusModel>(`/sheet-capture-sessions/${sessionId}`);
    },
    enabled: sessionId !== null,
    refetchInterval: (query) => {
      if (!isPolling(query.state.data?.status)) return false;
      return attempts.current < MAX_ATTEMPTS ? POLL_INTERVAL_MS : false;
    },
  });
}
