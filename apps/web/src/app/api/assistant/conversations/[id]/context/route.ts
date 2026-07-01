import { cookies } from 'next/headers';

/**
 * Proxy para persistir la bandeja de contexto fijada de una conversación
 * (E21 — Ola 5). El cliente envía el set completo de refs (`{ pinnedContext }`)
 * vía PUT same-origin; este handler adjunta el Bearer de la cookie httpOnly y
 * reenvía al backend NestJS. Espejo del proxy de mensajes. Devuelve
 * `AssistantContextUpdateResponse` tal cual.
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

export async function PUT(
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
  const body = await req.text(); // se reenvía verbatim ({ pinnedContext })

  let upstream: Response;
  try {
    upstream = await fetch(
      `${API_BASE}/api/assistant/conversations/${encodeURIComponent(id)}/context`,
      {
        method: 'PUT',
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

  const text = await upstream.text().catch(() => '');
  return new Response(text || JSON.stringify({ message: 'Error del asistente' }), {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
