import { ApiConnectionError, ApiRequestError } from './errors';

/**
 * Fetch client-safe para Client Components (TanStack Query) — ver
 * .claude/rules/frontend/06-client-data-fetching.md. Contraparte de `api.ts`
 * (Server Components/Actions, `server-only`): en vez de adjuntar el Bearer
 * directamente (el navegador no puede leer la cookie httpOnly de sesión),
 * pega same-origin a `/api/proxy/...`, que reenvía la petición autenticada al
 * backend. Lanza el mismo `ApiRequestError` que `api.ts` — misma moneda de
 * error en toda la app.
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/proxy${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch {
    throw new ApiConnectionError();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiRequestError(
      res.status,
      (body as { message?: string }).message ?? `API error ${res.status}`,
      body,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function apiClientGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

export function apiClientPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export function apiClientPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export function apiClientDelete<T = void>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}
