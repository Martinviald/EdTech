'use client';

import { useCallback, useState, useTransition } from 'react';
import Link from 'next/link';
import { ROUTES } from '@/lib/routes';
import { CheckCircle2, Loader2, RotateCcw, Upload, AlertCircle } from 'lucide-react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { toast } from 'sonner';
import type {
  SpecTableUploadResponse,
  SpecTableLinkResponse,
  SpecTableMappingDto,
  TaxonomyModel,
} from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  taxonomies: TaxonomyModel[];
}

export function SpecTableWizard({ instrumentId, taxonomies }: SpecTableWizardProps) {
  const [step, setStep] = useState<Step>('upload');
  const [isPending, startTransition] = useTransition();
  const [uploadResult, setUploadResult] = useState<SpecTableUploadResponse | null>(null);
  const [linkResult, setLinkResult] = useState<SpecTableLinkResponse | null>(null);
  const [taxonomyId, setTaxonomyId] = useState('');

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
    if (!uploadResult) return;
    if (!taxonomyId) {
      toast.error('Selecciona un marco académico de referencia');
      return;
    }

    const mapping: SpecTableMappingDto = {
      instrumentId,
      taxonomyId,
      fileData: uploadResult.fileData,
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
    setTaxonomyId('');
  };

  return (
    <div className="space-y-4">
      {step === 'upload' && <UploadSection onAccept={handleFileAccept} isPending={isPending} />}
      {step === 'map' && uploadResult && (
        <MapSection
          uploadResult={uploadResult}
          taxonomies={taxonomies}
          taxonomyId={taxonomyId}
          onTaxonomyChange={setTaxonomyId}
          onLink={handleLink}
          onCancel={handleReset}
          isPending={isPending}
        />
      )}
      {step === 'done' && linkResult && (
        <DoneSection result={linkResult} onReset={handleReset} instrumentId={instrumentId} />
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
        toast.error(r?.errors[0]?.message ?? 'Archivo rechazado. Verifica el formato.');
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
                {isDragActive ? 'Suelta el archivo aqui' : 'Arrastra tu archivo Excel o CSV'}
              </p>
              <p className="text-muted-foreground text-xs">.xlsx, .xls o .csv</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MapSection({
  uploadResult,
  taxonomies,
  taxonomyId,
  onTaxonomyChange,
  onLink,
  onCancel,
  isPending,
}: {
  uploadResult: SpecTableUploadResponse;
  taxonomies: TaxonomyModel[];
  taxonomyId: string;
  onTaxonomyChange: (id: string) => void;
  onLink: (mapping: Record<string, string>) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const { columns, preview } = uploadResult;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Marco académico de referencia</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-sm space-y-1.5">
            <Label className="text-sm">
              Marco académico <span className="text-destructive">*</span>
            </Label>
            <Select value={taxonomyId} onValueChange={onTaxonomyChange} disabled={isPending}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar marco académico" />
              </SelectTrigger>
              <SelectContent>
                {taxonomies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Los OA y habilidades de la tabla se vincularán contra la taxonomía de este marco
              académico.
            </p>
          </div>
        </CardContent>
      </Card>

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

      <ColumnMapper columns={columns} onLink={onLink} onCancel={onCancel} isPending={isPending} />
    </div>
  );
}

/** Etiqueta legible para cada tipo de nodo taxonómico. */
function nodeTypeLabel(type: string): string {
  switch (type) {
    case 'skill':
      return 'Habilidad';
    case 'objective':
    case 'learning_objective':
      return 'OA';
    case 'content':
      return 'Contenido';
    case 'axis':
      return 'Eje';
    case 'domain':
      return 'Dominio';
    default:
      return type;
  }
}

function DoneSection({
  result,
  onReset,
  instrumentId,
}: {
  result: SpecTableLinkResponse;
  onReset: () => void;
  instrumentId: string;
}) {
  const linkedItems = result.linkedItems ?? [];
  const unlinkedItems = result.unlinkedItems ?? [];
  const hasUnlinked = unlinkedItems.length > 0;
  const hasErrors = result.errors.length > 0;
  const isPartial = hasUnlinked || hasErrors;

  return (
    <div className="space-y-4">
      {/* Resumen */}
      <Card
        className={cn(
          isPartial ? 'border-warning/40 bg-warning/10' : 'border-success/40 bg-success/10',
        )}
      >
        <CardContent className="flex items-start gap-3 pt-6">
          {isPartial ? (
            <AlertCircle className="mt-0.5 h-5 w-5 text-warning" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" />
          )}
          <div className="space-y-1 text-sm">
            <p className="font-medium">
              {isPartial ? 'Vinculación parcial' : 'Vinculación completada'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="success">
                {linkedItems.length} vinculado{linkedItems.length === 1 ? '' : 's'}
              </Badge>
              {hasUnlinked && (
                <Badge
                  variant="outline"
                  className="border-warning/50 text-warning"
                >
                  {unlinkedItems.length} sin vincular
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ítems vinculados */}
      {linkedItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-success" />
              Ítems vinculados ({linkedItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-72 overflow-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Pregunta</TableHead>
                    <TableHead>Nodos taxonómicos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linkedItems.map((item) => (
                    <TableRow key={`linked-${item.position}`}>
                      <TableCell className="font-medium">{item.position}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {item.nodes.map((n, i) => (
                            <Badge key={i} variant="secondary" className="font-normal">
                              <span className="text-muted-foreground mr-1">
                                {nodeTypeLabel(n.type)}:
                              </span>
                              {n.name}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ítems no vinculados */}
      {hasUnlinked && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4 text-warning" />
              Ítems sin vincular ({unlinkedItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-72 overflow-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Pregunta</TableHead>
                    <TableHead>Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unlinkedItems.map((item, i) => (
                    <TableRow key={`unlinked-${item.position ?? 'na'}-${i}`}>
                      <TableCell className="font-medium">{item.position ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{item.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Errores de guardado */}
      {hasErrors && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-sm">Errores ({result.errors.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
              {result.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onReset} variant="outline">
          <RotateCcw className="mr-2 h-4 w-4" />
          Subir otra tabla
        </Button>
        <Link href={ROUTES.bancoItemSpecTable(instrumentId)}>
          <Button>Ver tabla de especificaciones</Button>
        </Link>
      </div>
    </div>
  );
}
