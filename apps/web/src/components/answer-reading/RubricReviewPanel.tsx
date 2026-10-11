'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ImageOff, Sparkles, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  rubricApprovalSchema,
  type RubricApprovalDto,
  type RubricLevelOption,
  type RubricReviewDetail,
  type ReviewQueueGroup,
} from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCallout } from '@/components/shared/AlertCallout';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { cn } from '@/lib/utils';
import { formatConfidence } from './review-labels';
import { highlightQuotes } from './rubric-highlight';
import { useRubricReviewDetail } from './use-rubric-review';
import type { WrittenAnswersScope } from './use-written-answers-review';

const MAX_SHORTCUT = 9;

export interface LevelShortcut {
  key: string;
  level: RubricLevelOption;
}

/**
 * Tecla de cada nivel: su propio código si es un dígito (`0`, `1`, `2`), y si
 * no, su posición en la rúbrica. Así la tecla coincide con lo que dice la pauta.
 */
export function levelShortcuts(levels: readonly RubricLevelOption[]): LevelShortcut[] {
  const taken = new Set<string>();
  const keyByCode = new Map<string, string>();
  for (const level of levels) {
    const code = level.code.trim();
    if (/^[0-9]$/.test(code) && !taken.has(code)) {
      taken.add(code);
      keyByCode.set(level.code, code);
    }
  }
  levels.forEach((level, index) => {
    if (keyByCode.has(level.code) || index > MAX_SHORTCUT) return;
    const key = String(index);
    if (taken.has(key)) return;
    taken.add(key);
    keyByCode.set(level.code, key);
  });
  return levels.flatMap((level) => {
    const key = keyByCode.get(level.code);
    return key === undefined ? [] : [{ key, level }];
  });
}

export function formatPoints(score: number): string {
  return score.toLocaleString('es-CL', { maximumFractionDigits: 2 });
}

function levelName(level: RubricLevelOption): string {
  return level.label ? `${level.code} · ${level.label}` : level.code;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export interface RubricReviewPanelProps {
  scope: WrittenAnswersScope;
  group: ReviewQueueGroup;
  position: number;
  total: number;
  pending: boolean;
  canUndo: boolean;
  onApprove: (dto: RubricApprovalDto, label: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onUndo: () => void;
}

export function RubricReviewPanel({
  scope,
  group,
  position,
  total,
  pending,
  canUndo,
  onApprove,
  onNext,
  onPrev,
  onUndo,
}: RubricReviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [memberIndex, setMemberIndex] = useState(0);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const safeIndex = Math.min(memberIndex, Math.max(0, group.members.length - 1));
  const member = group.members[safeIndex];
  const detailQuery = useRubricReviewDetail(scope, member?.decisionId ?? null);
  const detail = detailQuery.data;
  const shortcuts = useMemo(() => levelShortcuts(detail?.levels ?? []), [detail?.levels]);
  const selectedLevel = detail?.levels.find((level) => level.code === selectedCode) ?? null;
  const disabled = pending || !detail || detail.awaitingConfirmation;

  useEffect(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, []);

  const goToMember = useCallback((index: number) => {
    setMemberIndex(index);
    setSelectedCode(null);
  }, []);

  const goNext = useCallback(() => {
    if (safeIndex < group.members.length - 1) goToMember(safeIndex + 1);
    else onNext();
  }, [safeIndex, group.members.length, goToMember, onNext]);

  const goPrev = useCallback(() => {
    if (safeIndex > 0) goToMember(safeIndex - 1);
    else onPrev();
  }, [safeIndex, goToMember, onPrev]);

  const approve = useCallback(
    (levelCode: string, label: string) => {
      if (!member || disabled) return;
      const parsed = rubricApprovalSchema.safeParse({ decisionId: member.decisionId, levelCode });
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? 'No se pudo aprobar el nivel');
        return;
      }
      onApprove(parsed.data, label);
    },
    [member, disabled, onApprove],
  );

  const approveSelected = useCallback(() => {
    if (!selectedLevel) return;
    approve(
      selectedLevel.code,
      `Pregunta ${group.printedNumber}: nivel ${levelName(selectedLevel)}`,
    );
  }, [selectedLevel, approve, group.printedNumber]);

  const approveProposal = useCallback(() => {
    const proposal = detail?.proposal;
    if (!proposal) return;
    approve(
      proposal.levelCode,
      `Pregunta ${group.printedNumber}: propuesta de la IA (nivel ${proposal.levelCode})`,
    );
  }, [detail?.proposal, approve, group.printedNumber]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return;
      const key = e.key.toUpperCase();
      const run = (action: () => void) => {
        e.preventDefault();
        action();
      };

      if (e.key === 'ArrowRight') return run(goNext);
      if (e.key === 'ArrowLeft') return run(goPrev);
      if (key === 'U') return run(() => canUndo && !pending && onUndo());
      if (disabled) return;
      const shortcut = shortcuts.find((entry) => entry.key === e.key);
      if (shortcut) return run(() => setSelectedCode(shortcut.level.code));
      if (e.key === 'Enter') return run(approveSelected);
      if (key === 'A') return run(approveProposal);
    },
    [
      goNext,
      goPrev,
      canUndo,
      pending,
      onUndo,
      disabled,
      shortcuts,
      approveSelected,
      approveProposal,
    ],
  );

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="group"
      aria-label={`Grupo ${position} de ${total}: pregunta ${group.printedNumber}, calificación con rúbrica`}
      onKeyDown={handleKeyDown}
      className="space-y-4 rounded-lg border p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-foreground">
            Pregunta {group.printedNumber}
          </h3>
          <span className="text-sm text-muted-foreground">{group.formatLabel}</span>
          <StatusBadge tone="warning">Rúbrica</StatusBadge>
        </div>
        <span className="text-xs text-muted-foreground">
          Grupo {position} de {total}
          {group.members.length > 1
            ? ` · respuesta ${safeIndex + 1} de ${group.members.length}`
            : ''}
        </span>
      </div>

      {detailQuery.isPending ? (
        <Skeleton className="h-72 w-full" />
      ) : detail ? (
        <RubricDetailView
          detail={detail}
          shortcuts={shortcuts}
          selectedCode={selectedCode}
          disabled={disabled}
          onSelect={setSelectedCode}
          onApproveSelected={approveSelected}
          onApproveProposal={approveProposal}
        />
      ) : (
        <AlertCallout tone="danger" title="No se pudo cargar esta respuesta">
          Pasa a la siguiente y vuelve más tarde.
        </AlertCallout>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={goPrev}
          disabled={position <= 1 && safeIndex === 0}
          aria-label="Ir a la respuesta anterior"
        >
          <ArrowLeft className="mr-2 size-4" aria-hidden />
          Anterior
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onUndo}
          disabled={!canUndo || pending}
          aria-label="Deshacer la última revisión"
        >
          <Undo2 className="mr-2 size-4" aria-hidden />
          Deshacer
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={goNext}
          disabled={position >= total && safeIndex >= group.members.length - 1}
          aria-label="Ir a la respuesta siguiente"
        >
          Siguiente
          <ArrowRight className="ml-2 size-4" aria-hidden />
        </Button>
      </div>

      <p className="hidden flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground sm:flex">
        <span>
          <Kbd>0</Kbd>–<Kbd>9</Kbd> elegir nivel
        </span>
        <span>
          <Kbd>Enter</Kbd> aprobar el nivel elegido
        </span>
        <span>
          <Kbd>A</Kbd> aprobar la propuesta
        </span>
        <span>
          <Kbd>←</Kbd> <Kbd>→</Kbd> anterior / siguiente
        </span>
        <span>
          <Kbd>U</Kbd> deshacer
        </span>
      </p>
    </div>
  );
}

function RubricDetailView({
  detail,
  shortcuts,
  selectedCode,
  disabled,
  onSelect,
  onApproveSelected,
  onApproveProposal,
}: {
  detail: RubricReviewDetail;
  shortcuts: readonly LevelShortcut[];
  selectedCode: string | null;
  disabled: boolean;
  onSelect: (code: string) => void;
  onApproveSelected: () => void;
  onApproveProposal: () => void;
}) {
  const { proposal } = detail;
  const keyByCode = new Map(shortcuts.map((entry) => [entry.level.code, entry.key]));
  const proposedLevel = proposal
    ? detail.levels.find((level) => level.code === proposal.levelCode)
    : undefined;
  const selectedLevel = detail.levels.find((level) => level.code === selectedCode);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="flex min-h-40 items-center justify-center rounded-md border bg-muted/40 p-2">
          {detail.cropUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={detail.cropUrl}
              alt={`Recorte de la respuesta a la pregunta ${detail.printedNumber}`}
              className="max-h-80 w-auto rounded bg-card"
            />
          ) : (
            <div className="flex flex-col items-center gap-1 text-muted-foreground">
              <ImageOff className="size-6" aria-hidden />
              <span className="text-xs">Recorte no disponible</span>
            </div>
          )}
        </div>
        <section aria-label="Transcripción" className="space-y-1">
          <h4 className="text-sm font-medium text-foreground">Transcripción</h4>
          {detail.transcription ? (
            <p className="whitespace-pre-wrap break-words rounded-md border bg-card p-3 text-sm text-foreground">
              {highlightQuotes(detail.transcription, proposal?.evidenceQuotes ?? []).map(
                (segment, index) =>
                  segment.highlighted ? (
                    <mark key={index} className="rounded-sm bg-warning/20 px-0.5 text-foreground">
                      {segment.text}
                    </mark>
                  ) : (
                    <span key={index}>{segment.text}</span>
                  ),
              )}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No hay transcripción para esta respuesta.
            </p>
          )}
        </section>
      </div>

      <div className="space-y-4">
        {detail.stem && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Enunciado:</span> {detail.stem}
          </p>
        )}

        {detail.awaitingConfirmation && (
          <AlertCallout tone="info" title="Confirma el lote para calificar">
            Podrás aprobar un nivel cuando el lote esté confirmado y la respuesta quede asociada a
            su alumno.
          </AlertCallout>
        )}

        {proposal ? (
          <section
            aria-label="Propuesta de la IA"
            className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="size-4 text-primary" aria-hidden />
              <span className="text-sm font-medium text-foreground">
                La IA propone el nivel{' '}
                {proposedLevel ? levelName(proposedLevel) : proposal.levelCode}
                {proposedLevel ? ` (${formatPoints(proposedLevel.score)} pts)` : ''}
              </span>
              <span className="text-xs text-muted-foreground">
                confianza {formatConfidence(proposal.confidence)}
              </span>
            </div>
            {proposal.rationale && (
              <p className="text-sm text-muted-foreground">{proposal.rationale}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Es una sugerencia: la calificación solo cuenta cuando tú la apruebas.
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={disabled}
              onClick={onApproveProposal}
            >
              <Check className="mr-2 size-4" aria-hidden />
              Aprobar propuesta
              <Kbd className="ml-2">A</Kbd>
            </Button>
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">
            No hay propuesta de la IA para esta respuesta. Elige tú el nivel.
          </p>
        )}

        <fieldset className="space-y-2" disabled={disabled}>
          <legend className="mb-2 text-sm font-medium text-foreground">
            ¿Qué nivel de la rúbrica alcanza?
          </legend>
          {detail.levels.map((level) => {
            const key = keyByCode.get(level.code);
            const isSelected = level.code === selectedCode;
            return (
              <button
                key={level.code}
                type="button"
                aria-pressed={isSelected}
                aria-label={`Nivel ${levelName(level)}, ${formatPoints(level.score)} de ${formatPoints(detail.maxScore)} puntos`}
                onClick={() => onSelect(level.code)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                  isSelected && 'border-primary bg-primary/10',
                )}
              >
                {key !== undefined && <Kbd className="mt-0.5 shrink-0">{key}</Kbd>}
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{levelName(level)}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatPoints(level.score)} de {formatPoints(detail.maxScore)} pts
                    </span>
                    {proposal?.levelCode === level.code && (
                      <Badge variant="info" className="font-normal">
                        Propuesta IA
                      </Badge>
                    )}
                    {detail.approval?.levelCode === level.code && (
                      <Badge variant="success" className="font-normal">
                        Aprobado
                      </Badge>
                    )}
                  </span>
                  {level.descriptor && (
                    <span className="block text-sm text-muted-foreground">{level.descriptor}</span>
                  )}
                </span>
              </button>
            );
          })}
        </fieldset>

        <Button
          type="button"
          className="w-full sm:w-auto"
          disabled={disabled || !selectedLevel}
          onClick={onApproveSelected}
        >
          <Check className="mr-2 size-4" aria-hidden />
          {selectedLevel
            ? `Aprobar nivel ${levelName(selectedLevel)}`
            : 'Elige un nivel para aprobar'}
          {selectedLevel && <Kbd className="ml-2">Enter</Kbd>}
        </Button>
      </div>
    </div>
  );
}
