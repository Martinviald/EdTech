import {
  ANALYTICS_CAPABILITIES,
  CAPABILITY_UNAVAILABLE_CODE,
  type AnalyticsCapability,
  type CapabilityUnavailableError,
} from '@soe/types';

export class ApiConnectionError extends Error {
  constructor() {
    super('No se puede conectar con el servidor');
    this.name = 'ApiConnectionError';
  }
}

export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'ApiConnectionError' ||
    error.message === 'No se puede conectar con el servidor' ||
    error.message.includes('ECONNREFUSED') ||
    error.message.includes('fetch failed')
  );
}

const GENERIC_SERVER_ERROR_MESSAGE = 'Ocurrió un error inesperado. Intenta nuevamente.';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly details?: unknown;
  readonly displayMessage: string;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.details = details;
    this.displayMessage = status < 500 ? message : GENERIC_SERVER_ERROR_MESSAGE;
  }
}

export function getDisplayMessage(error: unknown, fallback = GENERIC_SERVER_ERROR_MESSAGE): string {
  if (error instanceof ApiRequestError) return error.displayMessage;
  if (error instanceof ApiConnectionError) return error.message;
  return fallback;
}

function isAnalyticsCapability(value: unknown): value is AnalyticsCapability {
  return typeof value === 'string' && (ANALYTICS_CAPABILITIES as readonly string[]).includes(value);
}

/**
 * Reconoce el 409 del `CapabilityGuard` (`REQUIRES_ITEM_LEVEL_DATA`) en un error
 * lanzado por `lib/api`. No es un fallo: es una respuesta de negocio que trae su
 * propio motivo, igual que `suppressed` + `suppressionReason` del benchmarking.
 * La vista lo pinta como estado explicativo, nunca como "algo salió mal".
 *
 * Devuelve el cuerpo tipado, o `null` si el error es cualquier otra cosa.
 */
export function asCapabilityUnavailable(error: unknown): CapabilityUnavailableError | null {
  if (!(error instanceof Error)) return null;
  const details = (error as Error & { details?: unknown }).details;
  if (!details || typeof details !== 'object') return null;
  const body = details as Record<string, unknown>;
  if (body.code !== CAPABILITY_UNAVAILABLE_CODE) return null;
  if (!isAnalyticsCapability(body.capability)) return null;
  if (typeof body.message !== 'string') return null;
  return {
    statusCode: 409,
    error: 'CapabilityUnavailable',
    code: CAPABILITY_UNAVAILABLE_CODE,
    capability: body.capability,
    message: body.message,
  };
}
