'use client';

import { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import type { InstrumentAttachmentModel } from '@soe/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/**
 * Botón "Ver enunciado" + previsualizador embebido del PDF del enunciado. Usa la
 * URL `inline` (previewUrl) en un iframe para mostrar el PDF sin descargarlo; el
 * navegador lo renderiza con su visor nativo. Deja siempre disponible la descarga.
 *
 * Si el almacenamiento no está configurado (previewUrl ausente) el botón cae a
 * abrir la descarga directa, para no dejar al usuario sin acceso al archivo.
 */
export function EnunciadoViewButton({
  enunciadoPdf,
}: {
  enunciadoPdf: InstrumentAttachmentModel;
}) {
  const [open, setOpen] = useState(false);
  const { previewUrl, downloadUrl, fileName } = enunciadoPdf;
  const title = fileName ?? 'Enunciado.pdf';

  // Sin URL de previsualización (S3 no configurado) no hay nada que embeber: el
  // botón se comporta como descarga directa si hay downloadUrl, o se oculta.
  if (!previewUrl) {
    if (!downloadUrl) return null;
    return (
      <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
        <Button variant="outline" size="sm" className="gap-2">
          <FileText className="size-4" aria-hidden />
          Ver enunciado
        </Button>
      </a>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FileText className="size-4" aria-hidden />
          Ver enunciado
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[88vh] w-[92vw] max-w-5xl flex-col gap-0 p-0">
        <DialogHeader className="flex-row items-center justify-between gap-4 space-y-0 border-b px-4 py-3 pr-12 text-left">
          <DialogTitle className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{title}</span>
          </DialogTitle>
          {downloadUrl ? (
            <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
              <Button variant="outline" size="sm" className="gap-2">
                <Download className="size-4" aria-hidden />
                Descargar
              </Button>
            </a>
          ) : null}
        </DialogHeader>
        <iframe
          src={previewUrl}
          title={`Vista previa de ${title}`}
          className="min-h-0 w-full flex-1 rounded-b-lg border-0 bg-muted"
        />
      </DialogContent>
    </Dialog>
  );
}
