'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import type { Route } from 'next';
import type { BatchStatusModel, ConfirmBatchResponse, PrintRunAssessmentOption } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCallout, StatusBadge } from '@/components/shared';
import { ROUTES } from '@/lib/routes';
import { useBatchStatus } from '../../../hooks/use-batch-status';
import { useRetryBatch } from '../../../hooks/use-review-queue';
import { BATCH_STATUS_META, SCAN_ROUTES } from '../../../escanear/batch-meta';
import { AssignAssessmentControl } from '../../../components/AssignAssessmentControl';
import { ReviewQueuePanel } from './ReviewQueue';

export type StudentOption = { studentId: string; name: string };

/** Tirada sin evaluación: el lote se puede revisar, pero no confirmar. */
export type AssessmentGap = {
  runId: string;
  imprimirHref: Route;
  assessments: PrintRunAssessmentOption[];
};

interface ReviewShellProps {
  batchId: string;
  initialBatch: BatchStatusModel;
  students: StudentOption[];
  rosterAvailable: boolean;
  assessmentGap: AssessmentGap | null;
}

export function ReviewShell({
  batchId,
  initialBatch,
  students,
  rosterAvailable,
  assessmentGap,
}: ReviewShellProps) {
  const { data: batch } = useBatchStatus(batchId, initialBatch);
  const [confirmResult, setConfirmResult] = useState<ConfirmBatchResponse | null>(null);
  const current = batch ?? initialBatch;

  if (confirmResult) {
    return <ConfirmedSummary result={confirmResult} />;
  }

  return (
    <div className="space-y-6">
      <BatchHeaderCard batch={current} />
      {assessmentGap && current.status !== 'confirmed' && (
        <AssessmentGapCallout gap={assessmentGap} />
      )}
      <BatchBody
        batchId={batchId}
        batch={current}
        students={students}
        rosterAvailable={rosterAvailable}
        onConfirmed={(result) => {
          setConfirmResult(result);
          toast.success('Lote confirmado: los resultados quedaron persistidos.');
        }}
      />
    </div>
  );
}

function AssessmentGapCallout({ gap }: { gap: AssessmentGap }) {
  return (
    <AlertCallout tone="warning" title="La tirada de este lote no tiene evaluación asociada">
      <p>
        Puedes revisar las lecturas, pero <strong>no vas a poder confirmar</strong> hasta asociar
        una evaluación: es el destino donde se guardan los resultados.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <AssignAssessmentControl runId={gap.runId} assessments={gap.assessments} />
        <Link href={gap.imprimirHref} className="text-sm underline underline-offset-4">
          Ver la tirada
        </Link>
      </div>
    </AlertCallout>
  );
}

function BatchHeaderCard({ batch }: { batch: BatchStatusModel }) {
  const meta = BATCH_STATUS_META[batch.status];
  const processing = batch.status === 'pending' || batch.status === 'processing';
  const percent =
    batch.pagesTotal && batch.pagesTotal > 0
      ? Math.min(100, Math.round((batch.pagesRead / batch.pagesTotal) * 100))
      : null;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
            {processing && (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                El lector está procesando las páginas…
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {batch.pagesRead} {batch.pagesRead === 1 ? 'página leída' : 'páginas leídas'}
            {batch.pagesTotal !== null ? ` de ${batch.pagesTotal}` : ''}
          </p>
        </div>

        {processing && (
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={percent ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progreso de lectura del lote"
          >
            {percent !== null ? (
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${percent}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
            )}
          </div>
        )}

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <CounterItem
            label="Hojas escaneadas"
            value={`${batch.counters.sheetsScanned} / ${batch.counters.sheetsExpected}`}
          />
          <CounterItem label="Marcas dudosas" value={String(batch.counters.marks.ambiguous)} />
          <CounterItem label="Dobles marcas" value={String(batch.counters.marks.multiple)} />
          <CounterItem label="Pendientes de revisión" value={String(batch.reviewPending)} />
        </dl>
      </CardContent>
    </Card>
  );
}

function CounterItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function BatchBody({
  batchId,
  batch,
  students,
  rosterAvailable,
  onConfirmed,
}: {
  batchId: string;
  batch: BatchStatusModel;
  students: StudentOption[];
  rosterAvailable: boolean;
  onConfirmed: (result: ConfirmBatchResponse) => void;
}) {
  const retry = useRetryBatch(batchId);

  if (batch.status === 'pending' || batch.status === 'processing') {
    return (
      <AlertCallout tone="info" title="Procesando el lote">
        Esta vista se actualiza sola cada pocos segundos. Cuando termine la lectura vas a ver acá la
        cola de revisión.
      </AlertCallout>
    );
  }

  if (batch.status === 'rejected') {
    return (
      <AlertCallout tone="danger" title="Lote rechazado: incompatibilidad de datos">
        <p>{batch.failureReason ?? 'La hoja escaneada no corresponde al layout de la tirada.'}</p>
        <p className="mt-2">
          Ningún reintento arregla esto: el instrumento cambió después de imprimir. Reimprime la
          tirada con el layout vigente (o corrige el instrumento) y escanea de nuevo.
        </p>
      </AlertCallout>
    );
  }

  if (batch.status === 'failed') {
    return (
      <AlertCallout tone="danger" title="Falla del sistema al procesar el lote">
        <p>
          {batch.failureReason ??
            'El servicio de lectura no respondió. Los archivos ya subidos se conservan.'}
        </p>
        <Button
          variant="outline"
          className="mt-3"
          disabled={retry.isPending}
          onClick={() => retry.mutate()}
        >
          {retry.isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
          ) : (
            <RotateCcw className="mr-2 size-4" aria-hidden />
          )}
          Reintentar sin volver a subir
        </Button>
      </AlertCallout>
    );
  }

  if (batch.status === 'confirmed') {
    return (
      <AlertCallout tone="success" title="Este lote ya fue confirmado">
        <p>Sus resultados están persistidos y disponibles en los dashboards.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href={ROUTES.resultados}>Ver resultados</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={SCAN_ROUTES.escanear}>Escanear otro lote</Link>
          </Button>
        </div>
      </AlertCallout>
    );
  }

  return (
    <ReviewQueuePanel
      batchId={batchId}
      students={students}
      rosterAvailable={rosterAvailable}
      onConfirmed={onConfirmed}
    />
  );
}

function ConfirmedSummary({ result }: { result: ConfirmBatchResponse }) {
  return (
    <div className="space-y-6">
      <AlertCallout tone="success" icon={CheckCircle2} title="Lote confirmado">
        Las lecturas revisadas quedaron persistidas como resultados. Los pendientes que asumiste
        quedaron registrados como decisión tuya.
      </AlertCallout>

      <Card>
        <CardContent className="pt-6">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <CounterItem label="Hojas persistidas" value={String(result.summary.sheetsPersisted)} />
            <CounterItem
              label="Respuestas registradas"
              value={String(result.summary.responsesPersisted)}
            />
            <CounterItem
              label="Pendientes asumidos"
              value={String(result.summary.assumedPending)}
            />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild>
              <Link href={ROUTES.resultados}>Ver resultados</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={SCAN_ROUTES.escanear}>Escanear otro lote</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
