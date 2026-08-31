'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { toast } from 'sonner';
import { Camera, FileText, Loader2, RotateCcw, ScanLine, Smartphone, Upload, X } from 'lucide-react';
import {
  createScanBatchSchema,
  DEFAULT_CAPTURE_PROFILES,
  type AssessCaptureIdentityModel,
  type CaptureSource,
  type PrintRunAssessmentOption,
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
import { AlertCallout, Field } from '@/components/shared';
import { AssignAssessmentControl } from '../components/AssignAssessmentControl';
import { cn } from '@/lib/utils';
import { confirmScanFile, createScanBatch, startScanBatch } from './actions';
import { SCAN_ROUTES } from './batch-meta';
import { CameraCaptureSection } from './CameraCaptureSection';
import { assessIdentityLabel } from './capture-identity';

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

/**
 * Una tirada NO es una evaluación: es el paquete de hojas físicas que se
 * imprimió para un curso. El selector muestra las dos cosas por separado
 * (y avisa cuando falta la evaluación) porque leer sólo el instrumento hacía
 * creer que se estaba eligiendo la evaluación del análisis.
 */
export type PrintRunOption = {
  id: string;
  instrumentId: string;
  courseLabel: string;
  instrumentName: string;
  sheetCount: number;
  createdLabel: string;
  assessmentName: string | null;
  imprimirHref: Route;
};

type UploadStatus = 'queued' | 'uploading' | 'confirming' | 'done' | 'error';

type UploadFileState = {
  file: File;
  status: UploadStatus;
  progress: number;
  error: string | null;
  origin?: 'camera';
  identity?: AssessCaptureIdentityModel | null;
};

type Phase = 'form' | 'creating' | 'uploading' | 'starting';

type UploadMode = 'files' | 'camera';

function captureEntryLabel(entry: UploadFileState): string | null {
  if (entry.origin !== 'camera' || !entry.identity) return null;
  return assessIdentityLabel(entry.identity);
}

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

export function ScanUploadForm({
  printRuns,
  assessmentsByInstrument,
}: {
  printRuns: PrintRunOption[];
  assessmentsByInstrument: Record<string, PrintRunAssessmentOption[]>;
}) {
  const router = useRouter();
  const [printRunId, setPrintRunId] = useState('');
  const [source, setSource] = useState<CaptureSource>('scanner');
  const [uploadMode, setUploadMode] = useState<UploadMode>('files');
  const [files, setFiles] = useState<UploadFileState[]>([]);
  const [phase, setPhase] = useState<Phase>('form');
  const batchIdRef = useRef<string | null>(null);
  const intentsRef = useRef<Map<number, ScanUploadIntent>>(new Map());

  const selectedRun = printRuns.find((run) => run.id === printRunId) ?? null;
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
    const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        results.push(await uploadOne(next.index, next.file));
      }
    });
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

  function handleCameraAccepted(
    file: File,
    identity: AssessCaptureIdentityModel | null,
  ): boolean {
    if (files.length >= MAX_FILES) {
      toast.error(`Máximo ${MAX_FILES} archivos por lote: la foto no se agregó.`);
      return false;
    }
    setFiles((prev) => [
      ...prev,
      { file, status: 'queued', progress: 0, error: null, origin: 'camera', identity },
    ]);
    return true;
  }

  function discardCameraCaptures(reason: string) {
    if (!files.some((entry) => entry.origin === 'camera')) return;
    setFiles((prev) => prev.filter((entry) => entry.origin !== 'camera'));
    toast.warning(reason);
  }

  function handlePrintRunChange(value: string) {
    if (value !== printRunId) {
      discardCameraCaptures(
        'Se quitaron las fotos de cámara: su control de calidad se hizo contra otra tirada. Vuelve a capturarlas.',
      );
    }
    setPrintRunId(value);
  }

  function handleSourceChange(value: CaptureSource) {
    if (value !== source) {
      discardCameraCaptures(
        'Se quitaron las fotos de cámara: su control de calidad usó el perfil de celular y cambiaste la fuente. Vuelve a capturarlas.',
      );
    }
    setSource(value);
    if (value !== 'phone') setUploadMode('files');
  }

  const cameraCaptures = files.filter((entry) => entry.origin === 'camera');
  const capturedIdentities = cameraCaptures
    .map((entry) => entry.identity)
    .filter((identity): identity is AssessCaptureIdentityModel => identity != null);
  const showCamera = editable && source === 'phone' && uploadMode === 'camera';

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
          Elige la tirada impresa, cómo se digitalizaron las hojas y sube los archivos. Las hojas se
          procesan y luego revisas las lecturas dudosas antes de confirmar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <Field
            label="Tirada impresa (el paquete de hojas de un curso)"
            htmlFor="print-run"
            required
            hint="No es la evaluación: la evaluación es el destino de los resultados y va asociada a la tirada."
          >
            <Select value={printRunId} onValueChange={handlePrintRunChange} disabled={!editable}>
              <SelectTrigger id="print-run" className="h-auto w-full py-2">
                <SelectValue placeholder="Selecciona la tirada que se rindió" />
              </SelectTrigger>
              <SelectContent>
                {printRuns.map((run) => (
                  <SelectItem key={run.id} value={run.id}>
                    <PrintRunOptionLabel run={run} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {selectedRun && !selectedRun.assessmentName && (
            <AlertCallout tone="warning" title="Esta tirada no tiene una evaluación asociada">
              <p>
                La evaluación es el destino de los resultados. Sin ella vas a poder subir y revisar
                el lote, pero <strong>no vas a poder confirmarlo</strong>: los resultados no
                tendrían dónde guardarse.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <AssignAssessmentControl
                  runId={selectedRun.id}
                  assessments={assessmentsByInstrument[selectedRun.instrumentId] ?? []}
                />
                <Link
                  href={selectedRun.imprimirHref}
                  className="text-sm underline underline-offset-4"
                >
                  Ver la tirada
                </Link>
              </div>
            </AlertCallout>
          )}

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
                      selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
                      !editable && 'cursor-not-allowed opacity-70',
                    )}
                  >
                    <input
                      type="radio"
                      name="capture-source"
                      value={option.value}
                      checked={selected}
                      onChange={() => handleSourceChange(option.value)}
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
            {editable && source === 'phone' && (
              <div className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-1">
                <Button
                  type="button"
                  variant={uploadMode === 'files' ? 'secondary' : 'ghost'}
                  onClick={() => setUploadMode('files')}
                >
                  <Upload className="mr-2 size-4" aria-hidden />
                  Subir fotos
                </Button>
                <Button
                  type="button"
                  variant={uploadMode === 'camera' ? 'secondary' : 'ghost'}
                  onClick={() => setUploadMode('camera')}
                >
                  <Camera className="mr-2 size-4" aria-hidden />
                  Cámara
                </Button>
              </div>
            )}

            {showCamera ? (
              printRunId === '' ? (
                <AlertCallout tone="info" title="Primero elige la tirada">
                  El control de calidad revisa cada foto contra la tirada que se rindió: selecciona
                  la tirada de impresión arriba para activar la cámara.
                </AlertCallout>
              ) : (
                <CameraCaptureSection
                  printRunId={printRunId}
                  expectedSheets={selectedRun?.sheetCount ?? null}
                  capturedIdentities={capturedIdentities}
                  capturedCount={cameraCaptures.length}
                  onAccepted={handleCameraAccepted}
                />
              )
            ) : (
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
            )}

            {files.length > 0 && (
              <ul className="divide-y rounded-lg border">
                {files.map((entry, index) => (
                  <li key={`${entry.file.name}-${index}`} className="flex items-center gap-3 p-3">
                    {entry.origin === 'camera' ? (
                      <Camera className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {captureEntryLabel(entry) ?? entry.file.name}
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
                        onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
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

function PrintRunOptionLabel({ run }: { run: PrintRunOption }) {
  return (
    <span className="flex flex-col gap-0.5 text-left">
      <span className="text-sm font-medium text-foreground">
        {run.courseLabel} · {run.instrumentName}
      </span>
      <span className="text-xs text-muted-foreground">
        {run.assessmentName ? (
          <>Evaluación: {run.assessmentName}</>
        ) : (
          <span className="font-medium text-warning">Sin evaluación asociada</span>
        )}
      </span>
      <span className="text-xs text-muted-foreground">
        {run.sheetCount} hojas · impresa el {run.createdLabel}
      </span>
    </span>
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
