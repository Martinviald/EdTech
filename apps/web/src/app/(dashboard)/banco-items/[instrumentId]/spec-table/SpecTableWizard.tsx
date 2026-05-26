'use client';

import { useCallback, useState, useTransition } from 'react';
import { CheckCircle2, Loader2, RotateCcw, Upload, AlertCircle } from 'lucide-react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { toast } from 'sonner';
import type {
  SpecTableUploadResponse,
  SpecTableLinkResponse,
  SpecTableMappingDto,
} from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { uploadSpecTable, linkSpecTable } from './actions';
import { ColumnMapper } from './ColumnMapper';

type Step = 'upload' | 'map' | 'done';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = {
  'text/csv': ['.csv'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
};

interface SpecTableWizardProps {
  instrumentId: string;
}

export function SpecTableWizard({ instrumentId }: SpecTableWizardProps) {
  const [step, setStep] = useState<Step>('upload');
  const [isPending, startTransition] = useTransition();
  const [uploadResult, setUploadResult] = useState<SpecTableUploadResponse | null>(null);
  const [linkResult, setLinkResult] = useState<SpecTableLinkResponse | null>(null);

  const handleFileAccept = useCallback(
    (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('instrumentId', instrumentId);

      startTransition(async () => {
        const result = await uploadSpecTable(formData);
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        setUploadResult(result.data);
        setStep('map');
      });
    },
    [instrumentId],
  );

  const handleLink = (columnMapping: Record<string, string>) => {
    const mapping: SpecTableMappingDto = {
      instrumentId,
      columnMapping,
    };

    startTransition(async () => {
      const result = await linkSpecTable(mapping);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setLinkResult(result.data);
      setStep('done');
      toast.success('Tabla de especificaciones vinculada correctamente');
    });
  };

  const handleReset = () => {
    setStep('upload');
    setUploadResult(null);
    setLinkResult(null);
  };

  return (
    <div className="space-y-4">
      {step === 'upload' && (
        <UploadSection
          onAccept={handleFileAccept}
          isPending={isPending}
        />
      )}
      {step === 'map' && uploadResult && (
        <MapSection
          uploadResult={uploadResult}
          onLink={handleLink}
          onCancel={handleReset}
          isPending={isPending}
        />
      )}
      {step === 'done' && linkResult && (
        <DoneSection result={linkResult} onReset={handleReset} />
      )}
    </div>
  );
}

function UploadSection({
  onAccept,
  isPending,
}: {
  onAccept: (file: File) => void;
  isPending: boolean;
}) {
  const onDrop = useCallback(
    (accepted: File[], rejections: FileRejection[]) => {
      if (rejections.length > 0) {
        const r = rejections[0];
        toast.error(
          r?.errors[0]?.message ?? 'Archivo rechazado. Verifica el formato.',
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
    accept: ACCEPTED_TYPES,
    maxFiles: 1,
    maxSize: MAX_BYTES,
    disabled: isPending,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Subir archivo</CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="flex items-center justify-center gap-3 rounded-lg border p-10">
            <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            <span className="text-muted-foreground text-sm">Procesando archivo...</span>
          </div>
        ) : (
          <div
            {...getRootProps()}
            className={cn(
              'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors cursor-pointer',
              isDragActive
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:bg-muted/50',
            )}
          >
            <input {...getInputProps()} />
            <Upload className="text-muted-foreground h-10 w-10" />
            <div className="space-y-1">
              <p className="font-medium">
                {isDragActive
                  ? 'Suelta el archivo aqui'
                  : 'Arrastra tu archivo Excel o CSV'}
              </p>
              <p className="text-muted-foreground text-xs">
                .xlsx, .xls o .csv
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MapSection({
  uploadResult,
  onLink,
  onCancel,
  isPending,
}: {
  uploadResult: SpecTableUploadResponse;
  onLink: (mapping: Record<string, string>) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const { columns, preview } = uploadResult;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vista previa del archivo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 mb-3">
            <Badge variant="secondary">
              {preview.length} fila{preview.length === 1 ? '' : 's'}
            </Badge>
            <Badge variant="outline">
              {columns.length} columna{columns.length === 1 ? '' : 's'}
            </Badge>
          </div>
          <div className="max-h-48 overflow-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => (
                    <TableHead key={col} className="whitespace-nowrap text-xs">
                      {col}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.slice(0, 5).map((row, idx) => (
                  <TableRow key={idx}>
                    {columns.map((col) => (
                      <TableCell key={col} className="text-xs">
                        {String(row[col] ?? '')}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {preview.length > 5 && (
            <p className="text-muted-foreground text-xs mt-2">
              Mostrando 5 de {preview.length} filas.
            </p>
          )}
        </CardContent>
      </Card>

      <ColumnMapper
        columns={columns}
        onLink={onLink}
        onCancel={onCancel}
        isPending={isPending}
      />
    </div>
  );
}

function DoneSection({
  result,
  onReset,
}: {
  result: SpecTableLinkResponse;
  onReset: () => void;
}) {
  const hasErrors = result.errors.length > 0;

  return (
    <div className="space-y-4">
      <Card
        className={cn(
          hasErrors
            ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20'
            : 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20',
        )}
      >
        <CardContent className="flex items-start gap-3 pt-6">
          {hasErrors ? (
            <AlertCircle className="mt-0.5 h-5 w-5 text-amber-600 dark:text-amber-400" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          )}
          <div className="space-y-1 text-sm">
            <p className="font-medium">
              {hasErrors ? 'Vinculacion parcial' : 'Vinculacion completada'}
            </p>
            <p className="text-muted-foreground">
              {result.linked} item{result.linked === 1 ? '' : 's'} vinculado
              {result.linked === 1 ? '' : 's'} correctamente.
            </p>
          </div>
        </CardContent>
      </Card>

      {hasErrors && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Errores ({result.errors.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {result.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button onClick={onReset} variant="outline">
          <RotateCcw className="mr-2 h-4 w-4" />
          Subir otra tabla
        </Button>
      </div>
    </div>
  );
}
