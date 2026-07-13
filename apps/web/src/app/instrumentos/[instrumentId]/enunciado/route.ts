import 'server-only';
import { NextResponse } from 'next/server';
import { apiGet } from '@/lib/api';
import type { InstrumentAttachmentModel } from '@soe/types';

// Nunca cachear: la URL prefirmada debe generarse en cada request.
export const dynamic = 'force-dynamic';

/**
 * Redirige a una URL prefirmada FRESCA del PDF del enunciado de un instrumento.
 *
 * La URL se genera en el momento del click (cuando el navegador abre este handler
 * en una pestaña nueva), no al renderizar la vista que muestra el botón. Así el
 * enlace nunca está vencido aunque la página lleve mucho rato abierta —evitando el
 * error de acceso denegado de S3 por firma expirada—.
 *
 * Autentica con la sesión del usuario (el middleware ya bloquea a los no
 * autenticados; `apiGet` reusa la cookie de sesión como Bearer). Los instrumentos
 * oficiales son visibles para todos; los propios, sólo para su organización.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ instrumentId: string }> },
) {
  const { instrumentId } = await params;

  let pdf: InstrumentAttachmentModel | null = null;
  try {
    pdf = await apiGet<InstrumentAttachmentModel | null>(
      `/instruments/${instrumentId}/enunciado-pdf`,
    );
  } catch {
    pdf = null;
  }

  const url = pdf?.previewUrl ?? pdf?.downloadUrl;
  if (!url) {
    return new NextResponse(
      'No hay un PDF de enunciado disponible para este instrumento.',
      { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  // 302: redirección temporal a la URL prefirmada (de corta vida).
  return NextResponse.redirect(url, 302);
}
