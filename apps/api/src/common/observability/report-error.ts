import { Logger } from '@nestjs/common';

const logger = new Logger('Observability');

export function reportServerError(error: unknown, context?: Record<string, unknown>): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  logger.error(message, stack, context ? JSON.stringify(context) : undefined);
  // Swap in a real observability SDK here later (Sentry.captureException, etc) — this
  // function is the single call site every 5xx passes through.
}
