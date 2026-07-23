'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AnswerSheetPreviewResponse } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageContainer, PageHeader } from '@/components/shared';
import { cn } from '@/lib/utils';
import { confirmAnswerSheetAction, previewAnswerSheetAction } from '../actions';
import { PreviewTable } from '../components/preview-table';
import { ROUTES } from '@/lib/routes';

const FORMAT_LABELS: Record<string, string> = {
  gradecam_csv: 'Gradecam (CSV)',
  zipgrade_csv: 'ZipGrade (CSV)',
  dia_official: 'DIA oficial',
  generic_csv: 'CSV genérico',
};

export default function PreviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [preview, setPreview] = useState<AnswerSheetPreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [skipErrorRows, setSkipErrorRows] = useState(true);
  const [isConfirming, startConfirming] = useTransition();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setLoadError('Falta el token de previsualización.');
        setLoading(false);
        return;
      }
      setLoading(true);
      const result = await previewAnswerSheetAction(token);
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message);
      } else {
        setPreview(result.data);
        setLoadError(null);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleConfirm = () => {
    if (!token || !preview) return;
    setConfirmError(null);
    startConfirming(async () => {
      const result = await confirmAnswerSheetAction({
        previewToken: token,
        createAssessment: true,
        skipErrorRows,
      });
      if (!result.ok) {
        setConfirmError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success('Importación confirmada.');
      router.push(ROUTES.importarResultadosJob(result.data.jobId));
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 rounded-lg border bg-card p-10">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
        <span className="text-muted-foreground text-sm">Cargando previsualización…</span>
      </div>
    );
  }

  if (loadError || !preview) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="space-y-0.5">
            <p className="font-medium">No se pudo cargar la previsualización</p>
            <p>{loadError ?? 'El token puede haber expirado. Vuelve a subir el archivo.'}</p>
          </div>
        </div>
        <div>
          <Button
            variant="outline"
            onClick={() => router.push(ROUTES.importarResultadosCargar)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a cargar archivo
          </Button>
        </div>
      </div>
    );
  }

  const { summary, rows, instrumentName, detectedColumns, warnings, format } = preview;
  const canConfirm = summary.matchedStudents > 0 && (skipErrorRows || summary.rowsWithErrors === 0);

  return (
    <PageContainer>
      <PageHeader
        title="Previsualización"
        description="Revisa las filas detectadas. Aún no se ha guardado nada — confirma abajo para crear la evaluación y registrar las respuestas."
        meta={
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{FORMAT_LABELS[format] ?? format}</Badge>
            <span className="text-muted-foreground">·</span>
            <span className="font-medium">{instrumentName}</span>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Filas totales" value={summary.totalRows} variant="neutral" />
        <Stat label="Alumnos encontrados" value={summary.matchedStudents} variant="success" />
        <Stat
          label="No encontrados"
          value={summary.unmatchedStudents}
          variant={summary.unmatchedStudents > 0 ? 'warn' : 'neutral'}
        />
        <Stat
          label="Filas con error"
          value={summary.rowsWithErrors}
          variant={summary.rowsWithErrors > 0 ? 'warn' : 'neutral'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cobertura de ítems</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="font-medium">{summary.itemsCovered}</span> de{' '}
            <span className="font-medium">{summary.itemsInInstrument}</span> ítems del instrumento
            están presentes en el archivo.
          </p>
          {detectedColumns.length > 0 && (
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs uppercase">Columnas detectadas</p>
              <div className="flex flex-wrap gap-1">
                {detectedColumns.map((col) => (
                  <code key={col} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {col}
                  </code>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {warnings.length > 0 && (
        <Card className="border-warning/40 bg-warning/10">
          <CardHeader>
            <CardTitle className="text-sm text-warning">
              Advertencias ({warnings.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-warning">
            <ul className="list-disc pl-5">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filas detectadas</CardTitle>
        </CardHeader>
        <CardContent>
          <PreviewTable rows={rows} />
        </CardContent>
      </Card>

      {summary.rowsWithErrors > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Opciones</CardTitle>
          </CardHeader>
          <CardContent>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={skipErrorRows}
                onChange={(e) => setSkipErrorRows(e.target.checked)}
                className="mt-0.5 h-4 w-4"
                disabled={isConfirming}
              />
              <span>
                <span className="font-medium">Omitir filas con errores y continuar</span>
                <span className="text-muted-foreground block text-xs">
                  Si lo desmarcas, la importación se cancelará si hay errores.
                </span>
              </span>
            </label>
          </CardContent>
        </Card>
      )}

      {confirmError && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="space-y-0.5">
            <p className="font-medium">No se pudo confirmar la importación</p>
            <p>{confirmError}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          onClick={() => router.push(ROUTES.importarResultadosCargar)}
          disabled={isConfirming}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver
        </Button>
        <Button onClick={handleConfirm} disabled={isConfirming || !canConfirm}>
          {isConfirming ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          {isConfirming ? 'Confirmando…' : 'Confirmar importación'}
        </Button>
      </div>
    </PageContainer>
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
    success: 'border-success/30 bg-success/10 text-success',
    warn: 'border-warning/40 bg-warning/10 text-warning',
    info: 'border-info/30 bg-info/10 text-info',
    neutral: 'border-muted bg-muted/30 text-foreground',
  };
  return (
    <div className={cn('rounded-lg border p-4', colors[variant])}>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs opacity-80">{label}</p>
    </div>
  );
}
