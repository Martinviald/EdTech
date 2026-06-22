import { cookies } from 'next/headers';

/**
 * Proxy de streaming SSE del asistente IA (E21 — Ola 4).
 *
 * El token de sesión de NextAuth vive en una cookie httpOnly: el navegador NO
 * puede leerlo para mandarlo como `Authorization`. Por eso el chat hace `fetch`
 * a ESTE route handler (mismo origen → la cookie viaja sola), que lee el token
 * en el servidor y reenvía la petición al backend NestJS, devolviendo su stream
 * `text/event-stream` tal cual al cliente. Sin buffering (force-dynamic).
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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!API_BASE) {
    return Response.json({ message: 'API_URL no configurada' }, { status: 500 });
  }

  const token = await getBearerToken();
  if (!token) {
    return Response.json({ message: 'No autenticado' }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.text(); // se reenvía verbatim ({ content, pageContext? })

  let upstream: Response;
  try {
    upstream = await fetch(
      `${API_BASE}/api/assistant/conversations/${encodeURIComponent(id)}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body,
      },
    );
  } catch {
    return Response.json({ message: 'No se pudo conectar con el asistente' }, { status: 502 });
  }

  // Error del backend (gating, 404, validación): reenviar status + cuerpo JSON.
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return new Response(text || JSON.stringify({ message: 'Error del asistente' }), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Stream SSE: se pasa el cuerpo del backend directo al cliente.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
