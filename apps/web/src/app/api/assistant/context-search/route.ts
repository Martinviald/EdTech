import { cookies } from 'next/headers';

/**
 * Proxy de la búsqueda unificada de contexto del asistente (E21 — Ola 5).
 *
 * El token de sesión vive en una cookie httpOnly que el navegador no puede leer:
 * el picker hace `fetch` same-origin a ESTE route handler (la cookie viaja sola),
 * que lee el token en el servidor y reenvía la consulta al backend NestJS. Espejo
 * del proxy de mensajes. Devuelve `AssistantContextSearchResponse` tal cual.
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

export async function GET(req: Request): Promise<Response> {
  if (!API_BASE) {
    return Response.json({ message: 'API_URL no configurada' }, { status: 500 });
  }

  const token = await getBearerToken();
  if (!token) {
    return Response.json({ message: 'No autenticado' }, { status: 401 });
  }

  // Se reenvía el querystring verbatim (kind, q, limit) → el backend lo valida.
  const search = new URL(req.url).search;

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE}/api/assistant/context-search${search}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return Response.json({ message: 'No se pudo conectar con el asistente' }, { status: 502 });
  }

  const text = await upstream.text().catch(() => '');
  return new Response(text || JSON.stringify({ message: 'Error del asistente' }), {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
