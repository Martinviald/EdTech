'use client';

import { useCallback, useState, useTransition } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { AlertCircle, CheckCircle2, FileUp, Loader2, RotateCcw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type {
  StudentImportCommitResponse,
  StudentImportPreviewResponse,
} from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { commitImportAction, previewImportAction } from '@/app/(dashboard)/importar/actions';

type Step = 'upload' | 'previewing' | 'preview' | 'committing' | 'done';

const MAX_BYTES = 5 * 1024 * 1024;

export function StudentImportFlow() {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<StudentImportPreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<StudentImportCommitResponse | null>(null);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [, startTransition] = useTransition();

  const reset = () => {
    setStep('upload');
    setFile(null);
    setPreview(null);
    setCommitResult(null);
    setConfirmCreate(false);
  };

  const runPreview = useCallback((f: File) => {
    setFile(f);
    setStep('previewing');
    startTransition(async () => {
      const fd = new FormData();
      fd.append('file', f);
      const result = await previewImportAction(fd);
      if (!result.ok) {
        toast.error(result.message);
        setStep('upload');
        return;
      }
      setPreview(result.data);
      setStep('preview');
    });
  }, []);

  const runCommit = () => {
    if (!file || !preview) return;
    if (preview.newClassGroups.length > 0 && !confirmCreate) {
      toast.error('Debes confirmar la creación de los cursos nuevos.');
      return;
    }
    setStep('committing');
    startTransition(async () => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('confirmCreateMissingCourses', String(confirmCreate));
      const result = await commitImportAction(fd);
      if (!result.ok) {
        toast.error(result.message);
        setStep('preview');
        return;
      }
      setCommitResult(result.data);
      setStep('done');
      toast.success('Importación completada');
    });
  };

  return (
    <div className="space-y-4">
      {step === 'upload' && <UploadStep onAccept={runPreview} />}
      {step === 'previewing' && <LoadingPanel label="Procesando archivo..." />}
      {step === 'preview' && preview && (
        <PreviewStep
          file={file}
          preview={preview}
          confirmCreate={confirmCreate}
          onToggleConfirm={setConfirmCreate}
          onCancel={reset}
          onCommit={runCommit}
        />
      )}
      {step === 'committing' && <LoadingPanel label="Guardando alumnos..." />}
      {step === 'done' && commitResult && (
        <DoneStep result={commitResult} onReset={reset} />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

function UploadStep({ onAccept }: { onAccept: (file: File) => void }) {
  const onDrop = useCallback(
    (accepted: File[], rejections: FileRejection[]) => {
      if (rejections.length > 0) {
        const r = rejections[0];
        toast.error(
          r?.errors[0]?.message ?? 'Archivo rechazado. Verifica que sea un CSV válido < 5 MB.',
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
    accept: {
      'text/csv': ['.csv'],
      'text/plain': ['.csv'],
      'application/vnd.ms-excel': ['.csv'],
    },
    maxFiles: 1,
    maxSize: MAX_BYTES,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors cursor-pointer',
        isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:bg-muted/50',
      )}
    >
      <input {...getInputProps()} />
      <Upload className="text-muted-foreground h-10 w-10" />
      <div className="space-y-1">
        <p className="font-medium">
          {isDragActive ? 'Suelta el archivo aquí' : 'Arrastra tu CSV o haz clic para seleccionar'}
        </p>
        <p className="text-muted-foreground text-xs">CSV con encabezado · máximo 5 MB</p>
      </div>
    </div>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 rounded-lg border p-10">
      <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      <span className="text-muted-foreground text-sm">{label}</span>
    </div>
  );
}

function PreviewStep({
  file,
  preview,
  confirmCreate,
  onToggleConfirm,
  onCancel,
  onCommit,
}: {
  file: File | null;
  preview: StudentImportPreviewResponse;
  confirmCreate: boolean;
  onToggleConfirm: (v: boolean) => void;
  onCancel: () => void;
  onCommit: () => void;
}) {
  const hasUnknownGrades = preview.unknownGrades.length > 0;
  const hasNewCourses = preview.newClassGroups.length > 0;
  const errors = preview.errors;
  const validRows = preview.validRows;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <FileUp className="text-muted-foreground h-4 w-4" />
        <span className="font-medium">{file?.name ?? 'archivo.csv'}</span>
        <Badge variant="outline">{preview.totalRows} filas</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Válidas" value={validRows} variant="success" />
        <Stat label="Con error" value={errors.length} variant={errors.length > 0 ? 'warn' : 'neutral'} />
        <Stat
          label="Cursos nuevos"
          value={preview.newClassGroups.length}
          variant={hasNewCourses ? 'info' : 'neutral'}
        />
      </div>

      {hasUnknownGrades && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20">
          <CardHeader>
            <CardTitle className="text-sm text-red-900 dark:text-red-200">
              Cursos sin nivel reconocido
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-red-900 dark:text-red-200">
            <p>
              Los siguientes cursos no se pudieron mapear a un nivel conocido. Corrígelos en el
              CSV y vuelve a subirlo:
            </p>
            <ul className="list-disc pl-5">
              {preview.unknownGrades.map((g) => (
                <li key={g.label}>
                  <span className="font-medium">{g.label}</span> · filas{' '}
                  {g.rowNumbers.join(', ')}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {hasNewCourses && (
        <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20">
          <CardHeader>
            <CardTitle className="text-sm text-blue-900 dark:text-blue-200">
              Cursos nuevos detectados
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-blue-900 dark:text-blue-200">
            <ul className="list-disc pl-5">
              {preview.newClassGroups.map((c) => (
                <li key={c.label}>{c.label}</li>
              ))}
            </ul>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmCreate}
                onChange={(e) => onToggleConfirm(e.target.checked)}
                className="h-4 w-4"
              />
              <span>Crear estos cursos automáticamente al importar</span>
            </label>
          </CardContent>
        </Card>
      )}

      {errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Filas con error ({errors.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-64 overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">Fila</th>
                    <th className="px-3 py-2 font-medium">Campo</th>
                    <th className="px-3 py-2 font-medium">Mensaje</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((e, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2">{e.rowNumber}</td>
                      <td className="text-muted-foreground px-3 py-2">{e.field ?? '—'}</td>
                      <td className="px-3 py-2">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          onClick={onCommit}
          disabled={validRows === 0 || hasUnknownGrades || (hasNewCourses && !confirmCreate)}
        >
          {validRows === 0
            ? 'No hay filas válidas para importar'
            : `Confirmar e importar ${validRows} alumno${validRows === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  );
}

function DoneStep({
  result,
  onReset,
}: {
  result: StudentImportCommitResponse;
  onReset: () => void;
}) {
  const variant: 'success' | 'warn' = result.status === 'completed' ? 'success' : 'warn';
  const Icon = variant === 'success' ? CheckCircle2 : AlertCircle;
  return (
    <div className="space-y-4">
      <Card
        className={cn(
          variant === 'success'
            ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20'
            : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20',
        )}
      >
        <CardContent className="flex items-start gap-3 pt-6">
          <Icon
            className={cn(
              'mt-0.5 h-5 w-5',
              variant === 'success'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400',
            )}
          />
          <div className="space-y-1 text-sm">
            <p className="font-medium">
              {variant === 'success' ? 'Importación completada' : 'Importación parcial'}
            </p>
            <p className="text-muted-foreground">
              {result.inserted} insertado{result.inserted === 1 ? '' : 's'},{' '}
              {result.updated} actualizado{result.updated === 1 ? '' : 's'},{' '}
              {result.failed} con error{result.failed === 1 ? '' : 'es'}
              {result.classGroupsCreated > 0
                ? `, ${result.classGroupsCreated} curso${result.classGroupsCreated === 1 ? '' : 's'} nuevo${result.classGroupsCreated === 1 ? '' : 's'} creado${result.classGroupsCreated === 1 ? '' : 's'}`
                : ''}
              .
            </p>
          </div>
        </CardContent>
      </Card>

      {result.errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Filas omitidas ({result.errors.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-64 overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">Fila</th>
                    <th className="px-3 py-2 font-medium">Campo</th>
                    <th className="px-3 py-2 font-medium">Mensaje</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2">{e.rowNumber}</td>
                      <td className="text-muted-foreground px-3 py-2">{e.field ?? '—'}</td>
                      <td className="px-3 py-2">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button onClick={onReset} variant="outline">
          <RotateCcw className="mr-2 h-4 w-4" />
          Importar otra nómina
        </Button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: 'success' | 'warn' | 'info' | 'neutral';
}) {
  const colors: Record<typeof variant, string> = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200',
    warn: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200',
    info: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-200',
    neutral: 'border-muted bg-muted/30 text-foreground',
  };
  return (
    <div className={cn('rounded-lg border p-4', colors[variant])}>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs opacity-80">{label}</p>
    </div>
  );
}
