'use client';

import { useRef, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import type { BatchStatusModel, ConfirmBatchResponse } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCallout, CardSkeleton, Stepper, TopProgressBar } from '@/components/shared';
import { isMarkResolved, useReviewQueue } from '../../../hooks/use-review-queue';
import { ConfirmBatchDialog, isLikelyBlankScan, PagesReviewStep } from './ReviewQueue';
import { MarkReviewPanel } from './MarkReviewPanel';
import type { StudentOption } from './ReviewShell';
import {
  parseReviewStep,
  REVIEW_STEPS,
  REVIEW_STEP_IDS,
  REVIEW_STEP_INDEX,
  REVIEW_STEP_PARAM,
  type ReviewStepId,
} from './review-steps';

interface ReviewWizardProps {
  batchId: string;
  batch: BatchStatusModel;
  students: StudentOption[];
  rosterAvailable: boolean;
  /** La tirada sin evaluación asociada se puede revisar, pero no finalizar. */
  confirmDisabled: boolean;
  onConfirmed: (result: ConfirmBatchResponse) => void;
}

export function ReviewWizard({
  batchId,
  batch,
  students,
  rosterAvailable,
  confirmDisabled,
  onConfirmed,
}: ReviewWizardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, startTransition] = useTransition();

  const processing = batch.status === 'pending' || batch.status === 'processing';
  const { data: queue, isPending: queueLoading } = useReviewQueue(batchId, !processing);

  const pagesBaselineRef = useRef<number | null>(null);
  const pagesPending = queue ? queue.qualityRejected.length + queue.identityUnresolved.length : 0;
  if (queue && pagesBaselineRef.current === null) pagesBaselineRef.current = pagesPending;
  const pagesTotal = pagesBaselineRef.current ?? 0;
  const pagesDone = Math.max(0, pagesTotal - pagesPending);

  const marks = queue?.ambiguousMarks ?? [];
  const marksDone = marks.filter(isMarkResolved).length;
  const marksPending = marks.length - marksDone;

  const blankSheets = queue?.qualityRejected.filter(isLikelyBlankScan).length ?? 0;
  const unreadablePages = (queue?.qualityRejected.length ?? 0) - blankSheets;

  const suggestedStep: ReviewStepId = processing
    ? 'procesar'
    : pagesPending > 0
      ? 'paginas'
      : marksPending > 0
        ? 'marcas'
        : 'finalizar';
  const requestedStep = parseReviewStep(searchParams.get(REVIEW_STEP_PARAM));
  const step: ReviewStepId = processing ? 'procesar' : (requestedStep ?? suggestedStep);
  const stepIndex = REVIEW_STEP_INDEX[step];

  function goToStep(next: ReviewStepId) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(REVIEW_STEP_PARAM, next);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}` as Route, { scroll: false });
    });
  }

  const previousStep = REVIEW_STEP_IDS[stepIndex - 1];
  const nextStep = REVIEW_STEP_IDS[stepIndex + 1];

  return (
    <div className="relative space-y-6">
      <TopProgressBar active={isNavigating} />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <Stepper steps={REVIEW_STEPS} currentStep={stepIndex} />
          <StepProgress
            step={step}
            batch={batch}
            pagesDone={pagesDone}
            pagesTotal={pagesTotal}
            marksDone={marksDone}
            marksTotal={marks.length}
          />
        </CardContent>
      </Card>

      {queueLoading && !processing ? (
        <CardSkeleton />
      ) : (
        <>
          {step === 'procesar' && <ProcessingStep batch={batch} />}

          {step === 'paginas' && queue && (
            <PagesReviewStep
              batchId={batchId}
              qualityRejected={queue.qualityRejected}
              identityUnresolved={queue.identityUnresolved}
              students={students}
              rosterAvailable={rosterAvailable}
            />
          )}

          {step === 'marcas' &&
            (marks.length > 0 ? (
              <MarkReviewPanel batchId={batchId} marks={marks} />
            ) : (
              <AlertCallout tone="success" icon={CheckCircle2} title="No hay marcas dudosas">
                El lector leyó todas las marcas del lote sin dudar. Continúa para revisar el resumen
                y finalizar.
              </AlertCallout>
            ))}

          {step === 'finalizar' && (
            <FinalStep
              pagesPending={pagesPending}
              marksPending={marksPending}
              marksTotal={marks.length}
              blankSheets={blankSheets}
              unreadablePages={unreadablePages}
              batch={batch}
            />
          )}
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={() => previousStep && goToStep(previousStep)}
          disabled={!previousStep || processing}
        >
          <ArrowLeft className="mr-2 size-4" aria-hidden />
          Volver
        </Button>

        {nextStep ? (
          <Button onClick={() => goToStep(nextStep)} disabled={processing}>
            Continuar
            <ArrowRight className="ml-2 size-4" aria-hidden />
          </Button>
        ) : (
          <ConfirmBatchDialog
            batchId={batchId}
            pendingMarks={marksPending}
            pendingIdentities={queue?.identityUnresolved.length ?? 0}
            blankSheets={blankSheets}
            unreadablePages={unreadablePages}
            disabled={confirmDisabled}
            onConfirmed={onConfirmed}
          />
        )}
      </div>
    </div>
  );
}

function StepProgress({
  step,
  batch,
  pagesDone,
  pagesTotal,
  marksDone,
  marksTotal,
}: {
  step: ReviewStepId;
  batch: BatchStatusModel;
  pagesDone: number;
  pagesTotal: number;
  marksDone: number;
  marksTotal: number;
}) {
  const { label, done, total } = describeStepProgress(
    step,
    batch,
    pagesDone,
    pagesTotal,
    marksDone,
    marksTotal,
  );
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 100;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">
          Paso {REVIEW_STEP_INDEX[step] + 1} de {REVIEW_STEPS.length}
        </p>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function describeStepProgress(
  step: ReviewStepId,
  batch: BatchStatusModel,
  pagesDone: number,
  pagesTotal: number,
  marksDone: number,
  marksTotal: number,
): { label: string; done: number; total: number } {
  if (step === 'procesar') {
    const total = batch.pagesTotal ?? 0;
    return {
      label:
        total > 0
          ? `${batch.pagesRead} de ${total} ${total === 1 ? 'página leída' : 'páginas leídas'}`
          : 'El lector está procesando las páginas…',
      done: batch.pagesRead,
      total,
    };
  }
  if (step === 'paginas') {
    return {
      label:
        pagesTotal === 0
          ? 'Ninguna página quedó pendiente de revisión'
          : `${pagesDone} de ${pagesTotal} ${pagesTotal === 1 ? 'página resuelta' : 'páginas resueltas'}`,
      done: pagesDone,
      total: pagesTotal,
    };
  }
  if (step === 'marcas') {
    return {
      label:
        marksTotal === 0
          ? 'Ninguna marca quedó dudosa'
          : `${marksDone} de ${marksTotal} ${marksTotal === 1 ? 'marca revisada' : 'marcas revisadas'}`,
      done: marksDone,
      total: marksTotal,
    };
  }
  return { label: 'Revisa el resumen y finaliza la corrección', done: 1, total: 1 };
}

function ProcessingStep({ batch }: { batch: BatchStatusModel }) {
  return (
    <AlertCallout tone="info" icon={Loader2} title="El lector está procesando el lote">
      <p>
        Esta vista se actualiza sola cada pocos segundos. Cuando termine la lectura vas a poder
        continuar con la revisión: no hay nada que hacer todavía.
      </p>
      {batch.pagesTotal !== null && (
        <p className="mt-2">
          Llevamos {batch.pagesRead} de {batch.pagesTotal}{' '}
          {batch.pagesTotal === 1 ? 'página' : 'páginas'}.
        </p>
      )}
    </AlertCallout>
  );
}

function FinalStep({
  pagesPending,
  marksPending,
  marksTotal,
  blankSheets,
  unreadablePages,
  batch,
}: {
  pagesPending: number;
  marksPending: number;
  marksTotal: number;
  blankSheets: number;
  unreadablePages: number;
  batch: BatchStatusModel;
}) {
  const pendingTotal = pagesPending + marksPending;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Esto es lo que se va a guardar
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Nada se persiste hasta que finalices la corrección.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <SummaryItem
              label="Hojas escaneadas"
              value={`${batch.counters.sheetsScanned} / ${batch.counters.sheetsExpected}`}
            />
            <SummaryItem
              label="Marcas revisadas"
              value={`${marksTotal - marksPending} / ${marksTotal}`}
            />
            <SummaryItem label="Hojas sin respuestas" value={String(blankSheets)} />
            <SummaryItem label="Páginas ilegibles" value={String(unreadablePages)} />
          </dl>
        </CardContent>
      </Card>

      {pendingTotal === 0 ? (
        <AlertCallout tone="success" icon={CheckCircle2} title="No queda nada pendiente">
          Revisaste todo lo que el lector no pudo decidir solo. Finaliza la corrección para
          convertir las lecturas en resultados.
        </AlertCallout>
      ) : (
        <AlertCallout tone="warning" title="Todavía queda trabajo pendiente">
          <p>
            Puedes finalizar igual: los pendientes quedan registrados como una decisión tuya, con tu
            nombre.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {pagesPending > 0 && (
              <li>
                {pagesPending} {pagesPending === 1 ? 'página' : 'páginas'} sin resolver en el paso
                de páginas.
              </li>
            )}
            {marksPending > 0 && (
              <li>
                {marksPending} {marksPending === 1 ? 'marca dudosa' : 'marcas dudosas'} sin revisar.
              </li>
            )}
          </ul>
        </AlertCallout>
      )}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-foreground">{value}</dd>
    </div>
  );
}
