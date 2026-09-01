import { reportServerError } from '@/lib/observability';

/**
 * Proxy dedicado de captura remota (CD-22). El proxy genérico (`/api/proxy`)
 * exige cookie de sesión y pisa `Authorization`, así que no sirve para el
 * teléfono: acá se reenvía el `Authorization: Bearer <capture token>` ENTRANTE
 * tal cual — sin cookies, sin sesión — y SOLO hacia `sheet-capture/*` del
 * backend. El `CaptureSessionGuard` de NestJS valida el token en cada request;
 * este handler no agrega ninguna superficie de confianza.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const API_BASE = process.env.API_URL;

async function proxy(req: Request, path: string[]): Promise<Response> {
  if (!API_BASE) {
    return Response.json({ message: 'API_URL no configurada' }, { status: 500 });
  }

  const search = new URL(req.url).search;
  const upstreamPath = `sheet-capture/${path.map(encodeURIComponent).join('/')}`;
  const upstreamUrl = `${API_BASE}/api/${upstreamPath}${search}`;

  const authorization = req.headers.get('authorization');
  const hasBody = req.method === 'POST';
  const body = hasBody ? await req.text() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        ...(authorization ? { Authorization: authorization } : {}),
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
