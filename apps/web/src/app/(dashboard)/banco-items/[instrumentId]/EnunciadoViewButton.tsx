import { ExternalLink, FileText } from 'lucide-react';
import type { InstrumentAttachmentModel } from '@soe/types';
import { Button } from '@/components/ui/button';

/**
 * Botón "Ver enunciado": abre el PDF del enunciado en una PESTAÑA NUEVA, para
 * poder consultarlo junto a la vista de resultados al mismo tiempo. Usa la URL
 * `inline` (previewUrl) para que el navegador lo muestre con su visor nativo sin
 * descargarlo; si el almacenamiento no está configurado (sin previewUrl) cae a la
 * URL de descarga. Si no hay ninguna, no se muestra.
 */
export function EnunciadoViewButton({
  enunciadoPdf,
}: {
  enunciadoPdf: InstrumentAttachmentModel;
}) {
  const href = enunciadoPdf.previewUrl ?? enunciadoPdf.downloadUrl;
  if (!href) return null;

  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      <Button variant="outline" size="sm" className="gap-2">
        <FileText className="size-4" aria-hidden />
        Ver enunciado
        <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="sr-only">(se abre en una pestaña nueva)</span>
      </Button>
    </a>
  );
}
