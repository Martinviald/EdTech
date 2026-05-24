'use client';

import { ApiError } from '@/components/ui/api-error';
import { isConnectionError } from '@/lib/errors';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ApiError
      type={isConnectionError(error) ? 'connection' : 'generic'}
      message={error.message}
      onRetry={reset}
    />
  );
}
