'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import type { Route } from 'next';
import type { BatchStatusModel, ConfirmBatchResponse, PrintRunAssessmentOption } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCallout } from '@/components/shared';
import { ROUTES } from '@/lib/routes';
import { useBatchStatus } from '../../../hooks/use-batch-status';
import { useRetryBatch } from '../../../hooks/use-review-queue';
import { SCAN_ROUTES } from '../../../escanear/batch-meta';
import { AssignAssessmentControl } from '../../../components/AssignAssessmentControl';
import { ReviewWizard } from './ReviewWizard';

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
  /** Evaluación destino de la tirada. Null cuando la tirada todavía no tiene una asociada. */
  assessmentId: string | null;
}

export function ReviewShell({
  batchId,
  initialBatch,
  students,
  rosterAvailable,
  assessmentGap,
  assessmentId,
}: ReviewShellProps) {
  const { data: batch } = useBatchStatus(batchId, initialBatch);
  const [confirmResult, setConfirmResult] = useState<ConfirmBatchResponse | null>(null);
  const current = batch ?? initialBatch;

  const resultadosHref = assessmentId
    ? ROUTES.evaluacionResultados(assessmentId)
    : ROUTES.resultados;

  if (confirmResult) {
    return <ConfirmedSummary result={confirmResult} resultadosHref={resultadosHref} />;
  }

  return (
    <div className="space-y-6">
      {assessmentGap && current.status !== 'confirmed' && (
        <AssessmentGapCallout gap={assessmentGap} />
      )}
      <BatchBody
        batchId={batchId}
        batch={current}
        students={students}
        rosterAvailable={rosterAvailable}
        confirmDisabled={assessmentGap !== null}
        resultadosHref={resultadosHref}
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
  confirmDisabled,
  resultadosHref,
  onConfirmed,
}: {
  batchId: string;
  batch: BatchStatusModel;
  students: StudentOption[];
  rosterAvailable: boolean;
  confirmDisabled: boolean;
  resultadosHref: Route;
  onConfirmed: (result: ConfirmBatchResponse) => void;
}) {
  const retry = useRetryBatch(batchId);

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
            <Link href={resultadosHref}>Ver resultados</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={SCAN_ROUTES.escanear}>Escanear otro lote</Link>
          </Button>
        </div>
      </AlertCallout>
    );
  }

  return (
    <ReviewWizard
      batchId={batchId}
      batch={batch}
      students={students}
      rosterAvailable={rosterAvailable}
      confirmDisabled={confirmDisabled}
      onConfirmed={onConfirmed}
    />
  );
}

function ConfirmedSummary({
  result,
  resultadosHref,
}: {
  result: ConfirmBatchResponse;
  resultadosHref: Route;
}) {
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
              <Link href={resultadosHref}>Ver resultados</Link>
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
