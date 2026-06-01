'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { AlertCircle, Loader2, Upload } from 'lucide-react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { toast } from 'sonner';
import { ANSWER_SHEET_FORMATS, type AnswerSheetFormat } from '@soe/types';
import type { InstrumentModel } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { uploadAnswerSheetAction } from '../actions';

const MAX_BYTES = 10 * 1024 * 1024;

const FORMAT_LABELS: Record<AnswerSheetFormat, string> = {
  gradecam_csv: 'Gradecam (CSV)',
  zipgrade_csv: 'ZipGrade (CSV)',
  dia_official: 'DIA oficial (Agencia de Calidad)',
  generic_csv: 'CSV genérico',
};

interface UploadFormProps {
  defaultFormat: AnswerSheetFormat | null;
  instruments: InstrumentModel[];
}

export function UploadForm({ defaultFormat, instruments }: UploadFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [format, setFormat] = useState<AnswerSheetFormat>(
    defaultFormat ?? 'generic_csv',
  );
  const [instrumentId, setInstrumentId] = useState<string>('');
  const [assessmentName, setAssessmentName] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onDrop = useCallback(
    (accepted: File[], rejections: FileRejection[]) => {
      if (rejections.length > 0) {
        const r = rejections[0];
        const msg =
          r?.errors[0]?.message ??
          'Archivo rechazado. Verifica que sea un CSV válido menor a 10 MB.';
        toast.error(msg);
        return;
      }
      const first = accepted[0];
      if (first) {
        setFile(first);
        setErrorMessage(null);
      }
    },
    [],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'text/plain': ['.csv'],
      'application/vnd.ms-excel': ['.csv'],
    },
    maxFiles: 1,
    maxSize: MAX_BYTES,
    disabled: isPending,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!file) {
      setErrorMessage('Selecciona un archivo antes de continuar.');
      return;
    }
    if (!instrumentId) {
      setErrorMessage('Selecciona el instrumento DIA correspondiente.');
      return;
    }

    const fd = new FormData();
    fd.append('file', file);
    fd.append('format', format);
    fd.append('instrumentId', instrumentId);
    if (assessmentName.trim()) {
      fd.append('assessmentName', assessmentName.trim());
    }

    startTransition(async () => {
      const result = await uploadAnswerSheetAction(fd);
      if (!result.ok) {
        setErrorMessage(result.message);
        toast.error(result.message);
        return;
      }
      toast.success('Archivo procesado. Revisa la previsualización.');
      router.push(
        `/importar-resultados/preview?token=${encodeURIComponent(result.data.previewToken)}` as Route,
      );
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Archivo de respuestas</CardTitle>
        </CardHeader>
        <CardContent>
          {file ? (
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-muted-foreground text-xs">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFile(null)}
                disabled={isPending}
              >
                Cambiar
              </Button>
            </div>
          ) : (
            <div
              {...getRootProps()}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors sm:p-10',
                isDragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:bg-muted/50',
                isPending && 'pointer-events-none opacity-50',
              )}
            >
              <input {...getInputProps()} />
              <Upload className="text-muted-foreground h-10 w-10" />
              <div className="space-y-1">
                <p className="font-medium">
                  {isDragActive
                    ? 'Suelta el archivo aquí'
                    : 'Arrastra tu archivo o haz clic para seleccionar'}
                </p>
                <p className="text-muted-foreground text-xs">
                  CSV con encabezado · máximo 10 MB
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Configuración</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="format">Formato del archivo</Label>
              <Select
                value={format}
                onValueChange={(v) => setFormat(v as AnswerSheetFormat)}
                disabled={isPending}
              >
                <SelectTrigger id="format">
                  <SelectValue placeholder="Selecciona un formato" />
                </SelectTrigger>
                <SelectContent>
                  {ANSWER_SHEET_FORMATS.map((fmt) => (
                    <SelectItem key={fmt} value={fmt}>
                      {FORMAT_LABELS[fmt]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="instrument">Instrumento</Label>
              <Select
                value={instrumentId}
                onValueChange={setInstrumentId}
                disabled={isPending || instruments.length === 0}
              >
                <SelectTrigger id="instrument">
                  <SelectValue
                    placeholder={
                      instruments.length === 0
                        ? 'No hay instrumentos disponibles'
                        : 'Selecciona un instrumento'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {instruments.map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {inst.name}
                      {inst.year ? ` · ${inst.year}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {instruments.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  Primero debes importar la pauta DIA desde{' '}
                  <a
                    href="/importar-dia"
                    className="underline hover:text-foreground"
                  >
                    Importar pauta DIA
                  </a>
                  .
                </p>
              )}
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="assessment-name">
                Nombre de la evaluación (opcional)
              </Label>
              <Input
                id="assessment-name"
                placeholder="Por ejemplo: DIA Lectura 2° básico — Marzo 2026"
                value={assessmentName}
                onChange={(e) => setAssessmentName(e.target.value)}
                disabled={isPending}
                maxLength={300}
              />
              <p className="text-muted-foreground text-xs">
                Si no lo completas, se generará un nombre automáticamente.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {errorMessage && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="space-y-0.5">
            <p className="font-medium">No se pudo procesar el archivo</p>
            <p>{errorMessage}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push('/importar-resultados' as Route)}
          disabled={isPending}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={isPending || !file || !instrumentId}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isPending ? 'Procesando…' : 'Procesar archivo'}
        </Button>
      </div>
    </form>
  );
}
