'use client';

import { ApiError } from '@/components/ui/api-error';
import { isConnectionError } from '@/lib/errors';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <ApiError
        type={isConnectionError(error) ? 'connection' : 'generic'}
        message={error.message}
        onRetry={reset}
      />
    </div>
  );
}
