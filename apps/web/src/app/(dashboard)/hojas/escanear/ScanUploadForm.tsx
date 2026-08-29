'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { toast } from 'sonner';
import { FileText, Loader2, RotateCcw, ScanLine, Smartphone, Upload, X } from 'lucide-react';
import {
  createScanBatchSchema,
  DEFAULT_CAPTURE_PROFILES,
  type CaptureSource,
  type ScanUploadIntent,
} from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Field } from '@/components/shared';
import { cn } from '@/lib/utils';
import { confirmScanFile, createScanBatch, startScanBatch } from './actions';
import { SCAN_ROUTES } from './batch-meta';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 60;
const UPLOAD_CONCURRENCY = 3;
const ACCEPTED_TYPES = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
};

const SOURCE_OPTIONS: {
  value: CaptureSource;
  label: string;
  description: string;
  icon: typeof ScanLine;
}[] = [
  {
    value: 'scanner',
    label: 'Escáner',
    description: 'Hojas digitalizadas con un escáner o fotocopiadora (PDF o imágenes).',
    icon: ScanLine,
  },
  {
    value: 'phone',
    label: 'Celular',
    description: 'Fotos tomadas con la cámara del teléfono, una página por foto.',
    icon: Smartphone,
  },
];

export type PrintRunOption = { id: string; label: string };

type UploadStatus = 'queued' | 'uploading' | 'confirming' | 'done' | 'error';

type UploadFileState = {
  file: File;
  status: UploadStatus;
  progress: number;
  error: string | null;
};

type Phase = 'form' | 'creating' | 'uploading' | 'starting';

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function putWithProgress(
  intent: ScanUploadIntent,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(intent.method, intent.uploadUrl);
    for (const [key, value] of Object.entries(intent.headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`El almacenamiento respondió ${xhr.status} al subir el archivo`));
    };
    xhr.onerror = () => reject(new Error('Fallo de red al subir el archivo'));
    xhr.send(file);
  });
}

export function ScanUploadForm({ printRuns }: { printRuns: PrintRunOption[] }) {
  const router = useRouter();
  const [printRunId, setPrintRunId] = useState('');
  const [source, setSource] = useState<CaptureSource>('scanner');
  const [files, setFiles] = useState<UploadFileState[]>([]);
  const [phase, setPhase] = useState<Phase>('form');
  const batchIdRef = useRef<string | null>(null);
  const intentsRef = useRef<Map<number, ScanUploadIntent>>(new Map());

  const busy = phase === 'creating' || phase === 'starting';
  const editable = phase === 'form';

  const onDrop = useCallback((accepted: File[], rejections: FileRejection[]) => {
    if (rejections.length > 0) {
      toast.error(
        'Se descartaron archivos no válidos: sólo PDF, JPG o PNG de hasta 50 MB cada uno.',
      );
    }
    if (accepted.length === 0) return;
    setFiles((prev) => {
      const room = MAX_FILES - prev.length;
      if (room <= 0) {
        toast.error(`Máximo ${MAX_FILES} archivos por lote.`);
        return prev;
      }
      if (accepted.length > room) {
        toast.error(`Máximo ${MAX_FILES} archivos por lote: se agregaron los primeros ${room}.`);
      }
      const additions = accepted
        .slice(0, room)
        .map<UploadFileState>((file) => ({ file, status: 'queued', progress: 0, error: null }));
      return [...prev, ...additions];
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxSize: MAX_FILE_BYTES,
    multiple: true,
    disabled: !editable,
  });

  function patchFile(index: number, patch: Partial<UploadFileState>) {
    setFiles((prev) => prev.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  }

  async function uploadOne(index: number, file: File): Promise<boolean> {
    const intent = intentsRef.current.get(index);
    if (!intent) {
      patchFile(index, { status: 'error', error: 'No se recibió URL de subida para este archivo' });
      return false;
    }
    patchFile(index, { status: 'uploading', progress: 0, error: null });
    try {
      await putWithProgress(intent, file, (percent) => patchFile(index, { progress: percent }));
      patchFile(index, { status: 'confirming', progress: 100 });
      const confirmed = await confirmScanFile(intent.fileId, file.size);
      if (!confirmed.ok) throw new Error(confirmed.message);
      patchFile(index, { status: 'done' });
      return true;
    } catch (err) {
      patchFile(index, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Error al subir el archivo',
      });
      return false;
    }
  }

  async function runUploads(entries: { index: number; file: File }[]): Promise<boolean> {
    const queue = [...entries];
    const results: boolean[] = [];
    const workers = Array.from(
      { length: Math.min(UPLOAD_CONCURRENCY, queue.length) },
      async () => {
        for (;;) {
          const next = queue.shift();
          if (!next) return;
          results.push(await uploadOne(next.index, next.file));
        }
      },
    );
    await Promise.all(workers);
    return results.every(Boolean);
  }

  async function startAndRedirect() {
    const batchId = batchIdRef.current;
    if (!batchId) return;
    setPhase('starting');
    const started = await startScanBatch(batchId);
    if (!started.ok) {
      toast.error(started.message);
      setPhase('uploading');
      return;
    }
    toast.success('Lote en procesamiento: te llevamos al seguimiento.');
    router.push(SCAN_ROUTES.revisar(batchId));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = createScanBatchSchema.safeParse({
      printRunId,
      captureProfile: DEFAULT_CAPTURE_PROFILES[source],
      sources: files.map(({ file }) => ({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      })),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Revisa la tirada y los archivos del lote');
      return;
    }

    setPhase('creating');
    const created = await createScanBatch(parsed.data);
    if (!created.ok) {
      toast.error(created.message);
      setPhase('form');
      return;
    }

    batchIdRef.current = created.data.batchId;
    intentsRef.current = new Map(
      created.data.uploads.map((intent) => [intent.sourceIndex, intent]),
    );
    setPhase('uploading');
    const allOk = await runUploads(files.map(({ file }, index) => ({ index, file })));
    if (allOk) {
      await startAndRedirect();
    } else {
      toast.error('Algunos archivos no se pudieron subir. Reintenta los que fallaron.');
    }
  }

  async function handleRetryFailed() {
    const pendingEntries = files
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.status === 'error')
      .map(({ entry, index }) => ({ index, file: entry.file }));
    if (pendingEntries.length === 0) return;
    const retriedOk = await runUploads(pendingEntries);
    if (retriedOk) await startAndRedirect();
    else toast.error('Sigue habiendo archivos con error. Puedes reintentar de nuevo.');
  }

  const failedCount = files.filter((entry) => entry.status === 'error').length;
  const doneCount = files.filter((entry) => entry.status === 'done').length;
  const uploadInFlight =
    phase === 'uploading' &&
    files.some((entry) => entry.status === 'uploading' || entry.status === 'confirming');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nuevo lote de escaneo</CardTitle>
        <CardDescription>
          Elige la tirada impresa, cómo se digitalizaron las hojas y sube los archivos. Las hojas
          se procesan y luego revisas las lecturas dudosas antes de confirmar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <Field label="Tirada de impresión" htmlFor="print-run" required>
            <Select value={printRunId} onValueChange={setPrintRunId} disabled={!editable}>
              <SelectTrigger id="print-run" className="w-full">
                <SelectValue placeholder="Selecciona la tirada que se rindió" />
              </SelectTrigger>
              <SelectContent>
                {printRuns.map((run) => (
                  <SelectItem key={run.id} value={run.id}>
                    {run.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <fieldset className="space-y-2" disabled={!editable}>
            <legend className="text-sm font-medium text-foreground">
              ¿Cómo se digitalizaron las hojas?
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {SOURCE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = source === option.value;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors',
                      selected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted/50',
                      !editable && 'cursor-not-allowed opacity-70',
                    )}
                  >
                    <input
                      type="radio"
                      name="capture-source"
                      value={option.value}
                      checked={selected}
                      onChange={() => setSource(option.value)}
                      className="sr-only"
                    />
                    <Icon
                      className={cn(
                        'mt-0.5 size-5 shrink-0',
                        selected ? 'text-primary' : 'text-muted-foreground',
                      )}
                      aria-hidden
                    />
                    <span>
                      <span className="block text-sm font-medium text-foreground">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-3">
            <div
              {...getRootProps()}
              className={cn(
                'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
                isDragActive ? 'border-primary bg-primary/5' : 'border-border',
                editable ? 'cursor-pointer hover:bg-muted/40' : 'cursor-not-allowed opacity-70',
              )}
            >
              <input {...getInputProps()} aria-label="Agregar archivos del lote" />
              <Upload className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium text-foreground">
                Arrastra los archivos o haz clic para elegirlos
              </p>
              <p className="text-xs text-muted-foreground">
                PDF, JPG o PNG · hasta {MAX_FILES} archivos · máx. 50 MB cada uno
              </p>
            </div>

            {files.length > 0 && (
              <ul className="divide-y rounded-lg border">
                {files.map((entry, index) => (
                  <li key={`${entry.file.name}-${index}`} className="flex items-center gap-3 p-3">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {entry.file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatSize(entry.file.size)}
                        {entry.status === 'error' && entry.error ? ` · ${entry.error}` : ''}
                      </p>
                      {(entry.status === 'uploading' || entry.status === 'confirming') && (
                        <div
                          className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                          role="progressbar"
                          aria-valuenow={entry.progress}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`Progreso de subida de ${entry.file.name}`}
                        >
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${entry.progress}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <UploadStatusLabel status={entry.status} />
                    {editable && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Quitar ${entry.file.name}`}
                        onClick={() =>
                          setFiles((prev) => prev.filter((_, i) => i !== index))
                        }
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {phase === 'form' || phase === 'creating' ? (
              <Button type="submit" disabled={busy || files.length === 0 || !printRunId}>
                {phase === 'creating' ? (
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                ) : (
                  <Upload className="mr-2 size-4" aria-hidden />
                )}
                Subir y procesar
              </Button>
            ) : (
              <>
                <p className="text-sm text-muted-foreground" role="status">
                  {phase === 'starting'
                    ? 'Iniciando el procesamiento…'
                    : `${doneCount} de ${files.length} archivos subidos`}
                </p>
                {failedCount > 0 && !uploadInFlight && phase === 'uploading' && (
                  <Button type="button" variant="outline" onClick={handleRetryFailed}>
                    <RotateCcw className="mr-2 size-4" aria-hidden />
                    Reintentar {failedCount} {failedCount === 1 ? 'archivo' : 'archivos'}
                  </Button>
                )}
              </>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function UploadStatusLabel({ status }: { status: UploadStatus }) {
  if (status === 'queued') return null;
  if (status === 'done') {
    return <span className="text-xs font-medium text-success">Listo</span>;
  }
  if (status === 'error') {
    return <span className="text-xs font-medium text-destructive">Error</span>;
  }
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Loader2 className="size-3 animate-spin" aria-hidden />
      {status === 'confirming' ? 'Confirmando' : 'Subiendo'}
    </span>
  );
}
