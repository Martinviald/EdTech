import 'server-only';

export function reportServerError(error: unknown, context?: Record<string, unknown>): void {
  console.error('[server-error]', context ?? {}, error);
  // Swap in a real observability SDK here later (Sentry.captureException, etc) — this
  // function is the single call site every 5xx passes through.
}
