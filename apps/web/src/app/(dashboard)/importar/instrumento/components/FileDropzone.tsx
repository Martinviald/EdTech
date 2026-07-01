'use client';

import { useCallback } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

interface FileDropzoneProps {
  onAccept: (file: File) => void;
  accept?: Record<string, string[]>;
  label?: string;
  hint?: string;
  disabled?: boolean;
}

export function FileDropzone({
  onAccept,
  accept = { 'application/json': ['.json'] },
  label = 'Arrastra tu archivo o haz clic para seleccionar',
  hint = 'JSON de pauta DIA',
  disabled = false,
}: FileDropzoneProps) {
  const onDrop = useCallback(
    (accepted: File[], rejections: FileRejection[]) => {
      if (rejections.length > 0) {
        const r = rejections[0];
        toast.error(
          r?.errors[0]?.message ?? 'Archivo rechazado. Verifica el formato y que sea menor a 10 MB.',
        );
        return;
      }
      const first = accepted[0];
      if (first) onAccept(first);
    },
    [onAccept],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxFiles: 1,
    maxSize: MAX_BYTES,
    disabled,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors',
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'cursor-pointer hover:bg-muted/50',
        isDragActive && !disabled && 'border-primary bg-primary/5',
        !isDragActive && !disabled && 'border-muted-foreground/25',
      )}
    >
      <input {...getInputProps()} />
      <Upload className="text-muted-foreground h-10 w-10" />
      <div className="space-y-1">
        <p className="font-medium">
          {isDragActive ? 'Suelta el archivo aqui' : label}
        </p>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
    </div>
  );
}
