import type { CaptureSessionContextModel } from '@soe/types';
import { ApiRequestError } from '@/lib/errors';

export type MobileCapturePhase =
  | { phase: 'redeeming' }
  | { phase: 'redeem-failed'; message: string }
  | { phase: 'capturing'; token: string; context: CaptureSessionContextModel }
  | { phase: 'session-gone'; message: string }
  | { phase: 'finished' };

export function extractSecretFromHash(hash: string): string | null {
  const secret = hash.startsWith('#') ? hash.slice(1) : hash;
  return secret.length > 0 ? secret : null;
}

export function isSessionGone(err: unknown): boolean {
  return err instanceof ApiRequestError && err.status === 401;
}

export function captureErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) return err.displayMessage;
  if (err instanceof Error && err.message.length > 0) return err.message;
  return fallback;
}

export function captureContextLabel(context: CaptureSessionContextModel): string {
  const parts = [context.courseLabel, context.instrumentName].filter(
    (part): part is string => part !== null && part.length > 0,
  );
  return parts.length > 0 ? parts.join(' — ') : 'Sesión de captura activa';
}
