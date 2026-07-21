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
