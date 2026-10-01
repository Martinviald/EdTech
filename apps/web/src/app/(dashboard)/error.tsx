'use client';

import { ApiError } from '@/components/ui/api-error';
import { isConnectionError } from '@/lib/errors';
import { signOutToLogin } from '@/lib/sign-out';

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
      message={error.digest ? undefined : error.message}
      onRetry={reset}
      onSignOut={() => void signOutToLogin()}
      referenceCode={error.digest}
    />
  );
}
