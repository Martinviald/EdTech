import { AlertCircle, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import type { ImportJobModel, ImportJobStatus } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface JobStatusCardProps {
  job: ImportJobModel;
}

const STATUS_LABEL: Record<ImportJobStatus, string> = {
  pending: 'Pendiente',
  processing: 'Procesando',
  completed: 'Completado',
  failed: 'Fallido',
  partial: 'Completado con errores',
};

function statusVisual(status: ImportJobStatus) {
  switch (status) {
    case 'completed':
      return {
        Icon: CheckCircle2,
        className: 'border-success/30 bg-success/10 text-success',
      };
    case 'failed':
      return {
        Icon: XCircle,
        className:
          'border-destructive/30 bg-destructive/5 text-destructive',
      };
    case 'partial':
      return {
        Icon: AlertCircle,
        className: 'border-warning/40 bg-warning/10 text-warning',
      };
    case 'processing':
      return {
        Icon: Loader2,
        className: 'border-info/30 bg-info/10 text-info',
      };
    case 'pending':
    default:
      return {
        Icon: Clock,
        className: 'border-muted bg-muted/30 text-foreground',
      };
  }
}

function formatDate(value: string | Date | null): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CL', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export function JobStatusCard({ job }: JobStatusCardProps) {
  const { Icon, className } = statusVisual(job.status);
  const rowsProcessed = job.result?.rowsProcessed ?? 0;
  const errorsCount = job.result?.errors ?? 0;
  const warningsCount = job.result?.warnings ?? 0;
  const isInFlight = job.status === 'pending' || job.status === 'processing';

  return (
    <div className="space-y-4">
      <Card className={cn(className)}>
        <CardContent
          role="status"
          aria-live="polite"
          className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-start"
        >
          <Icon
            className={cn(
              'mt-0.5 h-6 w-6 shrink-0',
              job.status === 'processing' && 'animate-spin',
            )}
          />
          <div className="space-y-1 text-sm">
            <p className="text-base font-semibold">
              {STATUS_LABEL[job.status]}
            </p>
            <p>
              {rowsProcessed} fila{rowsProcessed === 1 ? '' : 's'} procesada
              {rowsProcessed === 1 ? '' : 's'} · {errorsCount} error
              {errorsCount === 1 ? '' : 'es'} · {warningsCount} advertencia
              {warningsCount === 1 ? '' : 's'}
            </p>
            {isInFlight && (
              <p className="opacity-80">
                La importación está en curso. Refresca esta página para ver el
                estado más reciente.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalles del job</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase text-muted-foreground">
                ID del job
              </dt>
              <dd className="font-mono break-all text-xs">{job.id}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-muted-foreground">
                Tipo
              </dt>
              <dd>
                <Badge variant="secondary">{job.type}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-muted-foreground">
                Iniciado
              </dt>
              <dd>{formatDate(job.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-muted-foreground">
                Finalizado
              </dt>
              <dd>{formatDate(job.completedAt)}</dd>
            </div>
            {job.assessmentId && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase text-muted-foreground">
                  ID de la evaluación
                </dt>
                <dd className="font-mono break-all text-xs">
                  {job.assessmentId}
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {job.errorLog && job.errorLog.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Errores ({job.errorLog.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-64 overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">Fila</th>
                    <th className="px-3 py-2 font-medium">Mensaje</th>
                  </tr>
                </thead>
                <tbody>
                  {job.errorLog.map((e, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{e.row}</td>
                      <td className="px-3 py-2">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
