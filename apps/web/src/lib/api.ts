import 'server-only';
import { cookies } from 'next/headers';
import { ApiConnectionError, ApiRequestError } from './errors';
import { reportServerError } from './observability';

function apiUrl(): string {
  const base = process.env.API_URL;
  if (!base) throw new Error('API_URL is required');
  return `${base}/api`;
}

function internalApiSecret(): string {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) throw new Error('INTERNAL_API_SECRET is required');
  return secret;
}

async function getBearerToken(): Promise<string> {
  const jar = await cookies();
  const token =
    jar.get('authjs.session-token')?.value ??
    jar.get('__Secure-authjs.session-token')?.value;
  if (!token) throw new Error('No autenticado');
  return token;
}

async function request<T>(
  path: string,
  options: RequestInit & { authenticated: boolean },
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options.authenticated) {
    headers['Authorization'] = `Bearer ${await getBearerToken()}`;
  } else {
    headers['x-internal-token'] = internalApiSecret();
  }

  let res: Response;
  try {
    res = await fetch(`${apiUrl()}${path}`, {
      ...options,
      headers: { ...options.headers, ...headers },
    });
  } catch {
    throw new ApiConnectionError();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = (body as { message?: string }).message ?? `API error ${res.status}`;
    if (res.status >= 500) reportServerError(new Error(message), { path, status: res.status });
    // Cuerpo crudo del error: algunos endpoints devuelven un código legible por
    // máquina además del mensaje (p. ej. el 409 `REQUIRES_ITEM_LEVEL_DATA` del
    // `CapabilityGuard`) y la UI necesita distinguirlo de un fallo genérico
    // (`asCapabilityUnavailable`, `lib/errors.ts`). Mismo trato que ya daba
    // `apiPostFormData` — antes solo esa función pasaba `body` como `details`.
    throw new ApiRequestError(res.status, message, body);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Llamadas autenticadas (Server Components / Server Actions) ────────────────

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET', authenticated: true });
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
    authenticated: true,
  });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
    authenticated: true,
  });
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    body: JSON.stringify(body),
    authenticated: true,
  });
}

export function apiDelete<T = void>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE', authenticated: true });
}

/**
 * POST autenticado con `multipart/form-data`. No define Content-Type:
 * fetch lo agrega con el boundary correcto cuando body es FormData.
 */
export async function apiPostFormData<T>(path: string, formData: FormData): Promise<T> {
  const token = await getBearerToken();
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}${path}`, {
      method: 'POST',
      body: formData,
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiConnectionError();
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      newClassGroups?: unknown;
      unknownGrades?: unknown;
    };
    const message = body.message ?? `API error ${res.status}`;
    if (res.status >= 500) reportServerError(new Error(message), { path, status: res.status });
    throw new ApiRequestError(res.status, message, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Llamadas internas sin Bearer (auth callbacks de NextAuth) ─────────────────

export function internalGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET', authenticated: false });
}

export function internalPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
    authenticated: false,
  });
}
