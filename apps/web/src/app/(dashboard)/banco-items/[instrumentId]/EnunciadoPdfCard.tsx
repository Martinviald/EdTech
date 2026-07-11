'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileText,
  Download,
  Loader2,
  Trash2,
  Upload,
  AlertCircle,
} from 'lucide-react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { toast } from 'sonner';
import type { InstrumentAttachmentModel } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import {
  requestEnunciadoUploadUrl,
  confirmEnunciadoPdf,
  deleteEnunciadoPdf,
} from './enunciado-actions';

const MAX_BYTES = 50 * 1024 * 1024;
const ACCEPTED_TYPES = { 'application/pdf': ['.pdf'] };

interface EnunciadoPdfCardProps {
  instrumentId: string;
  enunciadoPdf: InstrumentAttachmentModel | null;
  /** Roles EDITOR: puede subir/reemplazar/eliminar. El resto sólo ve/descarga. */
  canEdit: boolean;
}

function formatSize(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function EnunciadoPdfCard({
  instrumentId,
  enunciadoPdf,
  canEdit,
}: EnunciadoPdfCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const busy = isPending || isUploading;

  const handleUpload = useCallback(
    async (file: File) => {
      setIsUploading(true);
      try {
        // Paso 1: pedir la URL prefirmada.
        const urlResult = await requestEnunciadoUploadUrl(instrumentId, {
          fileName: file.name,
          mimeType: file.type || 'application/pdf',
          sizeBytes: file.size,
        });
        if (!urlResult.ok) {
          toast.error(urlResult.message);
          return;
        }

        // Paso 2: subir el archivo directo a S3 (desde el navegador).
        const { uploadUrl, storageKey, headers } = urlResult.data;
        const putRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers,
          body: file,
        });
        if (!putRes.ok) {
          toast.error('No se pudo subir el archivo al almacenamiento.');
          return;
        }

        // Paso 3: confirmar y persistir la metadata.
        const confirmResult = await confirmEnunciadoPdf(instrumentId, {
          storageKey,
          fileName: file.name,
          mimeType: file.type || 'application/pdf',
          sizeBytes: file.size,
        });
        if (!confirmResult.ok) {
          toast.error(confirmResult.message);
          return;
        }

        toast.success('PDF del enunciado guardado correctamente.');
        router.refresh();
      } catch {
        toast.error('Ocurrió un error al subir el PDF. Intenta nuevamente.');
      } finally {
        setIsUploading(false);
      }
    },
    [instrumentId, router],
  );

  const onDrop = useCallback(
    (accepted: File[], rejections: FileRejection[]) => {
      if (rejections.length > 0) {
        toast.error(
          rejections[0]?.errors[0]?.message ??
            'Archivo rechazado. Debe ser un PDF de hasta 50 MB.',
        );
        return;
      }
      const first = accepted[0];
      if (first) void handleUpload(first);
    },
    [handleUpload],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxFiles: 1,
    maxSize: MAX_BYTES,
    disabled: busy || !canEdit,
  });

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteEnunciadoPdf(instrumentId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setConfirmDelete(false);
      toast.success('PDF del enunciado eliminado.');
      router.refresh();
    });
  };

  const sizeLabel = enunciadoPdf ? formatSize(enunciadoPdf.sizeBytes) : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileText className="size-4 text-muted-foreground" aria-hidden />
          PDF del enunciado
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {enunciadoPdf ? (
          <div className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <FileText className="size-5 text-muted-foreground" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {enunciadoPdf.fileName ?? 'Enunciado.pdf'}
                </p>
                {sizeLabel ? (
                  <p className="text-xs text-muted-foreground">{sizeLabel}</p>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {enunciadoPdf.downloadUrl ? (
                <a
                  href={enunciadoPdf.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="outline" size="sm" className="gap-2">
                    <Download className="size-4" aria-hidden />
                    Ver / Descargar
                  </Button>
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Enlace de descarga no disponible
                </span>
              )}
              {canEdit ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Eliminar PDF del enunciado"
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Este instrumento aún no tiene un PDF de enunciado (cuadernillo) asociado.
          </p>
        )}

        {canEdit ? (
          <div>
            {busy ? (
              <div className="flex items-center justify-center gap-3 rounded-lg border p-6">
                <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
                <span className="text-sm text-muted-foreground">
                  {isUploading ? 'Subiendo PDF...' : 'Procesando...'}
                </span>
              </div>
            ) : (
              <div
                {...getRootProps()}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors',
                  isDragActive
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/25 hover:bg-muted/50',
                )}
              >
                <input {...getInputProps()} />
                <Upload className="size-8 text-muted-foreground" aria-hidden />
                <p className="text-sm font-medium">
                  {isDragActive
                    ? 'Suelta el PDF aquí'
                    : enunciadoPdf
                      ? 'Reemplazar el PDF del enunciado'
                      : 'Arrastra el PDF del enunciado'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Solo .pdf, hasta 50 MB
                </p>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="size-5 text-destructive" aria-hidden />
              Eliminar PDF del enunciado
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará el PDF del enunciado de este instrumento. Esta acción no se
              puede deshacer, pero podrás volver a subir otro archivo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
