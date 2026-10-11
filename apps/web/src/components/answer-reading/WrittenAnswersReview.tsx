'use client';

import { useCallback, useMemo, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type {
  ReviewMode,
  ReviewQueueGroup,
  ReviewQueueSummary,
  SubmitReviewDto,
  SubmitReviewResult,
} from '@soe/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCallout } from '@/components/shared/AlertCallout';
import { EmptyState } from '@/components/shared/EmptyState';
import { TopProgressBar } from '@/components/shared/TopProgressBar';
import { cn } from '@/lib/utils';
import { ReviewGroupPanel } from './ReviewGroupPanel';
import { REVIEW_MODE_LABELS } from './review-labels';
import {
  useSubmitReview,
  useUndoReview,
  useWrittenAnswersQueue,
  useWrittenAnswersSummary,
  type WrittenAnswersScope,
} from './use-written-answers-review';

const ALL_ITEMS = 'all';

interface UndoEntry {
  reviewIds: string[];
  decisionIds: string[];
  label: string;
}

export function sortGroupsBySize(groups: readonly ReviewQueueGroup[]): ReviewQueueGroup[] {
  return [...groups].sort((a, b) => b.size - a.size);
}

function withoutResolved(
  groups: readonly ReviewQueueGroup[],
  resolved: ReadonlySet<string>,
): ReviewQueueGroup[] {
  if (resolved.size === 0) return [...groups];
  const visible: ReviewQueueGroup[] = [];
  for (const group of groups) {
    const members = group.members.filter((member) => !resolved.has(member.decisionId));
    if (members.length === 0) continue;
    const removed = group.members.length - members.length;
    visible.push({ ...group, members, size: Math.max(members.length, group.size - removed) });
  }
  return visible;
}

function defaultMode(summary: ReviewQueueSummary | undefined): ReviewMode {
  if (summary && summary.pendingReading === 0 && summary.pendingGrading > 0) return 'grading';
  return 'reading';
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function describeResult(label: string, result: SubmitReviewResult): string {
  const applied = result.appliedDecisionIds.length;
  return `${label}: ${plural(applied, 'respuesta revisada', 'respuestas revisadas')}`;
}

function notifySkipped(result: SubmitReviewResult) {
  const skipped = result.skippedHumanScored.length;
  if (skipped === 0) return;
  toast.warning(
    skipped === 1
      ? 'Una respuesta ya tenía corrección humana; no se cambió.'
      : `${skipped} respuestas ya tenían corrección humana; no se cambiaron.`,
  );
}

function addIds(set: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const next = new Set(set);
  for (const id of ids) next.add(id);
  return next;
}

function removeIds(set: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const next = new Set(set);
  for (const id of ids) next.delete(id);
  return next;
}

export function WrittenAnswersReview({ scope }: { scope: WrittenAnswersScope }) {
  const summaryQuery = useWrittenAnswersSummary(scope);
  const summary = summaryQuery.data;
  const readingInProgress = (summary?.inProgress ?? 0) > 0;

  const [chosenMode, setChosenMode] = useState<ReviewMode | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [includeAudit, setIncludeAudit] = useState(false);
  const [page, setPage] = useState(1);
  const [index, setIndex] = useState(0);
  const [resolved, setResolved] = useState<ReadonlySet<string>>(() => new Set());
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const mode = chosenMode ?? defaultMode(summary);
  const queueQuery = useWrittenAnswersQueue(
    scope,
    { mode, itemId, includeAudit, page },
    { enabled: summary !== undefined, readingInProgress },
  );
  const submitReview = useSubmitReview(scope);
  const undoReview = useUndoReview(scope);

  const groups = useMemo(
    () => withoutResolved(sortGroupsBySize(queueQuery.data?.data ?? []), resolved),
    [queueQuery.data, resolved],
  );
  const safeIndex = Math.min(index, Math.max(0, groups.length - 1));
  const current = groups[safeIndex];
  const totalPages = queueQuery.data
    ? Math.max(1, Math.ceil(queueQuery.data.total / queueQuery.data.limit))
    : 1;

  const resetPosition = () => {
    setPage(1);
    setIndex(0);
  };

  const handleSubmit = useCallback(
    (dto: SubmitReviewDto, label: string) => {
      setResolved((prev) => addIds(prev, dto.decisionIds));
      submitReview.mutate(dto, {
        onSuccess: (result) => {
          setUndoStack((prev) => [
            ...prev,
            { reviewIds: result.reviewIds, decisionIds: dto.decisionIds, label },
          ]);
          setLastAction(describeResult(label, result));
          notifySkipped(result);
        },
        onError: () => setResolved((prev) => removeIds(prev, dto.decisionIds)),
      });
    },
    [submitReview],
  );

  const handleUndo = useCallback(() => {
    const last = undoStack[undoStack.length - 1];
    if (!last || undoReview.isPending) return;
    undoReview.mutate(last.reviewIds, {
      onSuccess: () => {
        setUndoStack((prev) => prev.slice(0, -1));
        setResolved((prev) => removeIds(prev, last.decisionIds));
        setLastAction(`Se deshizo: ${last.label}`);
      },
    });
  }, [undoStack, undoReview]);

  if (summaryQuery.isPending) return <WrittenAnswersSkeleton />;
  if (!summary) {
    return (
      <AlertCallout tone="danger" title="No se pudo cargar la revisión de respuestas escritas">
        Vuelve a intentar en unos segundos.
      </AlertCallout>
    );
  }

  return (
    <div className="space-y-4">
      <SummaryStrip summary={summary} />

      {readingInProgress && (
        <AlertCallout
          tone="info"
          icon={Loader2}
          iconClassName="animate-spin"
          title="Todavía se están leyendo respuestas"
        >
          Quedan {plural(summary.inProgress, 'respuesta', 'respuestas')} en lectura. Esta vista se
          actualiza sola; puedes revisar lo que ya está listo.
        </AlertCallout>
      )}

      <div className="relative flex flex-wrap items-center gap-2">
        <TopProgressBar active={queueQuery.isFetching && !queueQuery.isPending} />
        <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="Modo">
          {(['reading', 'grading'] as const).map((value) => {
            const count = value === 'reading' ? summary.pendingReading : summary.pendingGrading;
            return (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={mode === value ? 'default' : 'ghost'}
                aria-pressed={mode === value}
                onClick={() => {
                  setChosenMode(value);
                  resetPosition();
                }}
              >
                {REVIEW_MODE_LABELS[value]} ({count})
              </Button>
            );
          })}
        </div>

        {summary.byItem.length > 0 && (
          <Select
            value={itemId ?? ALL_ITEMS}
            onValueChange={(value) => {
              setItemId(value === ALL_ITEMS ? null : value);
              resetPosition();
            }}
          >
            <SelectTrigger className="h-9 w-full sm:w-64" aria-label="Filtrar por pregunta">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ITEMS}>Todas las preguntas</SelectItem>
              {summary.byItem.map((item) => (
                <SelectItem key={item.itemId} value={item.itemId}>
                  Pregunta {item.printedNumber} · {item.formatLabel} (
                  {item.pendingReading + item.pendingGrading})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {summary.pendingAudit > 0 && (
          <Button
            type="button"
            size="sm"
            variant={includeAudit ? 'secondary' : 'outline'}
            aria-pressed={includeAudit}
            onClick={() => {
              setIncludeAudit((prev) => !prev);
              resetPosition();
            }}
          >
            {includeAudit ? 'Ocultar' : 'Incluir'} muestra de auditoría ({summary.pendingAudit})
          </Button>
        )}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {lastAction ?? ''}
      </p>
      {lastAction && (
        <p className="text-sm text-muted-foreground" aria-hidden>
          {lastAction}
          {undoStack.length > 0 ? ' · U para deshacer' : ''}
        </p>
      )}

      {queueQuery.isPending ? (
        <Skeleton className="h-80 w-full" />
      ) : current ? (
        <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <GroupList groups={groups} activeIndex={safeIndex} onSelect={setIndex} />
          <ReviewGroupPanel
            key={`${current.groupKey}:${current.members.length}`}
            group={current}
            position={safeIndex + 1}
            total={groups.length}
            pending={submitReview.isPending || undoReview.isPending}
            canUndo={undoStack.length > 0}
            onSubmit={handleSubmit}
            onNext={() => setIndex(Math.min(safeIndex + 1, groups.length - 1))}
            onPrev={() => setIndex(Math.max(0, safeIndex - 1))}
            onUndo={handleUndo}
          />
        </div>
      ) : (
        <EmptyState
          icon={readingInProgress ? Loader2 : CheckCircle2}
          tone={readingInProgress ? 'neutral' : 'success'}
          title={
            readingInProgress
              ? 'Las respuestas se están leyendo'
              : `No quedan respuestas por revisar en modo ${REVIEW_MODE_LABELS[mode].toLowerCase()}`
          }
          description={
            readingInProgress
              ? 'Aparecerán aquí a medida que los lectores terminen.'
              : undoStack.length > 0
                ? 'Si te equivocaste, presiona Deshacer.'
                : undefined
          }
          action={
            undoStack.length > 0 ? (
              <Button type="button" variant="outline" size="sm" onClick={handleUndo}>
                Deshacer la última revisión
              </Button>
            ) : undefined
          }
        />
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => {
              setPage(page - 1);
              setIndex(0);
            }}
          >
            Grupos anteriores
          </Button>
          <span className="text-xs text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => {
              setPage(page + 1);
              setIndex(0);
            }}
          >
            Más grupos
          </Button>
        </div>
      )}
    </div>
  );
}

function SummaryStrip({ summary }: { summary: ReviewQueueSummary }) {
  const items = [
    { label: 'Por leer', value: summary.pendingReading },
    { label: 'Por corregir', value: summary.pendingGrading },
    { label: 'Auditoría', value: summary.pendingAudit },
    { label: 'Revisadas', value: summary.reviewed },
    { label: 'Aceptadas solas', value: summary.autoAccepted },
    { label: 'En lectura', value: summary.inProgress },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function GroupList({
  groups,
  activeIndex,
  onSelect,
}: {
  groups: readonly ReviewQueueGroup[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <nav aria-label="Grupos de respuestas">
      <ol className="flex gap-2 overflow-x-auto pb-1 lg:max-h-[32rem] lg:flex-col lg:overflow-y-auto lg:overflow-x-visible">
        {groups.map((group, index) => (
          <li key={group.groupKey} className="shrink-0">
            <button
              type="button"
              onClick={() => onSelect(index)}
              aria-current={index === activeIndex ? 'true' : undefined}
              className={cn(
                'flex w-full min-w-40 items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                index === activeIndex && 'border-primary bg-primary/5',
              )}
            >
              <span className="min-w-0">
                <span className="block font-medium text-foreground">
                  Pregunta {group.printedNumber}
                </span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {group.displayValue ?? group.canonical ?? 'sin lectura'}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-foreground">
                {group.size}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function WrittenAnswersSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
      <Skeleton className="h-9 w-72 max-w-full" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
