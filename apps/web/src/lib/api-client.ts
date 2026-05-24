import 'server-only';
import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/**
 * Cliente para llamar al API NestJS desde Server Components/Actions de Next.
 *
 * El API valida un JWE de NextAuth en `Authorization: Bearer <token>` (ver
 * `apps/api/src/auth/auth.guard.ts`). El token vive en una cookie HttpOnly
 * emitida por NextAuth (`authjs.session-token` o `__Secure-authjs.session-token`
 * en producción), así que aquí la leemos y la reenviamos en cada request.
 */
async function getSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return (
    jar.get('authjs.session-token')?.value ??
    jar.get('__Secure-authjs.session-token')?.value ??
    null
  );
}

type ApiOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  cache?: RequestCache;
  next?: NextFetchRequestConfig;
};

export async function apiFetch<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = await getSessionToken();
  if (!token) throw new Error('No autenticado');

  const url = `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: opts.cache ?? 'no-store',
    next: opts.next,
  });

  if (!res.ok) {
    const text = await res.text();
    let message = `API ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { message?: string | string[] };
      const m = parsed.message;
      message = Array.isArray(m) ? m.join(', ') : (m ?? message);
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
