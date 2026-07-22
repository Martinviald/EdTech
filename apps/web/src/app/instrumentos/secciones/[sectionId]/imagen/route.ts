import 'server-only';
import { NextResponse } from 'next/server';
import { apiGet } from '@/lib/api';
import type { SectionFigureModel } from '@soe/types';

// Nunca cachear: la URL prefirmada debe generarse en cada request.
export const dynamic = 'force-dynamic';

/**
 * Redirige a una URL prefirmada FRESCA de la ilustración de un pasaje/sección.
 *
 * Espejo de `/items/{id}/figura`: ruta ESTABLE, así el `<img src="/instrumentos/secciones/{id}/imagen">`
 * no caduca nunca —la firma se emite cuando el navegador pide la imagen, no cuando se renderizó la
 * vista—. Por eso la BDD guarda la storage key y no una URL (una presigned persistida dejaría el
 * `<img>` roto). Autentica con la sesión del usuario (`apiGet` reusa la cookie como Bearer); los
 * instrumentos oficiales son visibles para todos.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ sectionId: string }> }) {
  const { sectionId } = await params;

  let figure: SectionFigureModel | null = null;
  try {
    figure = await apiGet<SectionFigureModel | null>(`/instruments/sections/${sectionId}/imagen`);
  } catch {
    figure = null;
  }

  // `previewUrl` (inline) primero: la imagen debe mostrarse, no descargarse.
  const url = figure?.previewUrl ?? figure?.downloadUrl;
  if (!url) {
    return new NextResponse('No hay una ilustración disponible para esta sección.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  // 302: redirección temporal a la URL prefirmada (de corta vida).
  return NextResponse.redirect(url, 302);
}
