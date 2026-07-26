import { cookies } from 'next/headers';
import { reportServerError } from '@/lib/observability';

/**
 * Proxy genérico Cliente → NestJS para llamadas de TanStack Query (ver
 * .claude/rules/frontend/06-client-data-fetching.md). El token de sesión vive
 * en una cookie httpOnly que el navegador no puede leer: `lib/api-client.ts`
 * hace `fetch` same-origin a ESTE route handler (la cookie viaja sola), que
 * lee el token en el servidor y reenvía la petición al backend NestJS.
 *
 * No es una superficie de confianza nueva: el backend re-valida `AuthGuard`/
 * `RolesGuard`/`FeatureGuard` en cada request igual que si viniera directo de
 * `lib/api.ts` — este handler solo traduce cookie → header Bearer. Nunca
 * adjunta `x-internal-token` (ver `internalGet`/`internalPost` en
 * `lib/api.ts`), así que los endpoints internal-only son inalcanzables por acá.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const API_BASE = process.env.API_URL;

async function getBearerToken(): Promise<string | null> {
  const jar = await cookies();
  return (
    jar.get('authjs.session-token')?.value ??
    jar.get('__Secure-authjs.session-token')?.value ??
    null
  );
}

async function proxy(req: Request, path: string[]): Promise<Response> {
  if (!API_BASE) {
    return Response.json({ message: 'API_URL no configurada' }, { status: 500 });
  }

  const token = await getBearerToken();
  if (!token) {
    return Response.json({ message: 'No autenticado' }, { status: 401 });
  }

  const search = new URL(req.url).search;
  const upstreamPath = path.map(encodeURIComponent).join('/');
  const upstreamUrl = `${API_BASE}/api/${upstreamPath}${search}`;

  const hasBody = !['GET', 'HEAD', 'DELETE'].includes(req.method);
  const body = hasBody ? await req.text() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
    });
  } catch {
    return Response.json({ message: 'No se puede conectar con el servidor' }, { status: 502 });
  }

  if (upstream.status >= 500) {
    reportServerError(new Error(`Upstream ${upstream.status} on ${upstreamPath}`), {
      path: upstreamPath,
      method: req.method,
      status: upstream.status,
    });
  }

  const text = await upstream.text().catch(() => '');
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(req: Request, { params }: RouteContext): Promise<Response> {
  const { path } = await params;
  return proxy(req, path);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
