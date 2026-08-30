'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { FileDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadPrintRunPdf } from '../actions';

function base64ToPdfBlob(base64: string): Blob {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: 'application/pdf' });
}

function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function DownloadPdfButton({
  runId,
  variant = 'outline',
  size = 'sm',
}: {
  runId: string;
  variant?: 'default' | 'outline';
  size?: 'default' | 'sm';
}) {
  const [pending, startTransition] = useTransition();

  function handleDownload() {
    startTransition(async () => {
      const result = await downloadPrintRunPdf(runId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      triggerBrowserDownload(base64ToPdfBlob(result.base64), result.fileName);
      toast.success('PDF descargado');
    });
  }

  return (
    <Button variant={variant} size={size} onClick={handleDownload} disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="mr-2 size-4 animate-spin" />
          Generando…
        </>
      ) : (
        <>
          <FileDown className="mr-2 size-4" />
          Descargar PDF
        </>
      )}
    </Button>
  );
}
