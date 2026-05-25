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
