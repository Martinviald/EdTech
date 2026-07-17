import 'server-only';
import { NextResponse } from 'next/server';
import { apiGet } from '@/lib/api';
import type { AltFigureModel } from '@soe/types';

// Nunca cachear: la URL prefirmada debe generarse en cada request.
export const dynamic = 'force-dynamic';

/**
 * Redirige a una URL prefirmada FRESCA de la figura de UNA alternativa.
 *
 * Espejo de `/items/{id}/figura`: ruta ESTABLE, así el `<img>` de la alternativa no caduca
 * (la firma se emite cuando el navegador pide la imagen). Autentica con la sesión del
 * usuario; los ítems oficiales son visibles para todos.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ itemId: string; key: string }> },
) {
  const { itemId, key } = await params;

  let figure: AltFigureModel | null = null;
  try {
    figure = await apiGet<AltFigureModel | null>(
      `/items/${itemId}/alternativa/${encodeURIComponent(key)}/figura`,
    );
  } catch {
    figure = null;
  }

  // `previewUrl` (inline) primero: la imagen debe mostrarse, no descargarse.
  const url = figure?.previewUrl ?? figure?.downloadUrl;
  if (!url) {
    return new NextResponse('No hay una imagen disponible para esta alternativa.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  // 302: redirección temporal a la URL prefirmada (de corta vida).
  return NextResponse.redirect(url, 302);
}
