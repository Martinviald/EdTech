import 'server-only';
import { NextResponse } from 'next/server';
import { apiGet } from '@/lib/api';
import type { ItemFigureModel } from '@soe/types';

// Nunca cachear: la URL prefirmada debe generarse en cada request.
export const dynamic = 'force-dynamic';

/**
 * Redirige a una URL prefirmada FRESCA de la figura de un ítem.
 *
 * Es una ruta ESTABLE: el `<img src="/items/{id}/figura">` no caduca nunca porque
 * la firma se emite en el momento en que el navegador pide la imagen, no cuando se
 * renderizó la vista. Por eso la BDD guarda la storage key y no una URL —una
 * presigned persistida (máx. 7 días) dejaría el `<img>` roto.
 *
 * Autentica con la sesión del usuario: el middleware bloquea a los no autenticados
 * y `apiGet` reusa la cookie de sesión como Bearer. Los ítems oficiales son
 * visibles para todos; los propios, sólo para su organización.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;

  let figure: ItemFigureModel | null = null;
  try {
    figure = await apiGet<ItemFigureModel | null>(`/items/${itemId}/figura`);
  } catch {
    figure = null;
  }

  // `previewUrl` (inline) primero: la imagen debe mostrarse, no descargarse.
  const url = figure?.previewUrl ?? figure?.downloadUrl;
  if (!url) {
    return new NextResponse('No hay una figura disponible para esta pregunta.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  // 302: redirección temporal a la URL prefirmada (de corta vida).
  return NextResponse.redirect(url, 302);
}
