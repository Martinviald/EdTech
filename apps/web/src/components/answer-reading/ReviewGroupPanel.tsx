'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleOff,
  EyeOff,
  ImageOff,
  Pencil,
  Strikethrough,
  Undo2,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  submitReviewSchema,
  type GradingContext,
  type ReviewAction,
  type ReviewQueueGroup,
  type SubmitReviewDto,
} from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { cn } from '@/lib/utils';
import { buildEditedLiteral, editShapeFor, initialParts } from './edit-answer';
import { EditAnswerField } from './EditAnswerField';
import {
  formatConfidence,
  READING_STATE_LABELS,
  REVIEW_MODE_LABELS,
  REVIEW_MODE_QUESTIONS,
  REVIEW_REASON_LABELS,
  SCORING_OUTCOME_LABELS,
  SCORING_OUTCOME_TONES,
} from './review-labels';

const MAX_OPTION_KEYS = 9;

export interface ReadingOption {
  literal: string;
  sources: string[];
}

/**
 * Lecturas entre las que el revisor elige con `1..9`: primero la lectura de
 * cada lector y después sus alternativas, sin repetir el mismo literal.
 */
export function readingOptions(group: ReviewQueueGroup): ReadingOption[] {
  const byLiteral = new Map<string, ReadingOption>();
  const add = (literal: string | null, source: string) => {
    const key = literal?.trim();
    if (!key) return;
    const existing = byLiteral.get(key);
    if (existing) existing.sources.push(source);
    else byLiteral.set(key, { literal: key, sources: [source] });
  };
  for (const reader of group.readers) {
    if (reader.state === null || reader.state === 'answered') {
      add(reader.literal, `${reader.model} (${formatConfidence(reader.confidence)})`);
    }
  }
  for (const reader of group.readers) {
    for (const alternative of reader.alternatives) {
      add(
        alternative.literal,
        `alternativa de ${reader.model} (${formatConfidence(alternative.plausibility)})`,
      );
    }
  }
  return [...byLiteral.values()].slice(0, MAX_OPTION_KEYS);
}

function proposedGradingAction(grading: GradingContext | null): ReviewAction | null {
  if (grading?.proposedOutcome === 'correct') return 'mark_correct';
  if (grading?.proposedOutcome === 'incorrect') return 'mark_incorrect';
  return null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export interface ReviewGroupPanelProps {
  group: ReviewQueueGroup;
  position: number;
  total: number;
  pending: boolean;
  canUndo: boolean;
  onSubmit: (dto: SubmitReviewDto, label: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onUndo: () => void;
}

export function ReviewGroupPanel({
  group,
  position,
  total,
  pending,
  canUndo,
  onSubmit,
  onNext,
  onPrev,
  onUndo,
}: ReviewGroupPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const [editParts, setEditParts] = useState<string[] | null>(null);

  const isReading = group.mode === 'reading';
  const shape = useMemo(() => editShapeFor(group), [group]);
  const options = useMemo(() => (isReading ? readingOptions(group) : []), [group, isReading]);
  const included = group.members.filter((member) => !excluded.has(member.decisionId));
  const focused = group.members[Math.min(focusedIndex, group.members.length - 1)];
  const proposal = group.displayValue ?? group.canonical;
  const gradingProposal = isReading ? null : proposedGradingAction(group.grading);
  const disabled = pending || included.length === 0;

  const focusPanel = useCallback(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    focusPanel();
  }, [focusPanel]);

  const submit = useCallback(
    (action: ReviewAction, label: string, editedLiteral?: string) => {
      const parsed = submitReviewSchema.safeParse({
        decisionIds: included.map((member) => member.decisionId),
        mode: group.mode,
        action,
        ...(editedLiteral !== undefined ? { editedLiteral } : {}),
      });
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? 'No se pudo enviar la revisión');
        return;
      }
      onSubmit(parsed.data, label);
    },
    [included, group.mode, onSubmit],
  );

  const toggleExcluded = useCallback((decisionId: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(decisionId)) next.delete(decisionId);
      else next.add(decisionId);
      return next;
    });
  }, []);

  const startEdit = useCallback(() => {
    setEditParts(initialParts(shape, proposal));
  }, [shape, proposal]);

  const cancelEdit = useCallback(() => {
    setEditParts(null);
    focusPanel();
  }, [focusPanel]);

  const saveEdit = useCallback(() => {
    if (!editParts) return;
    const built = buildEditedLiteral(shape, editParts);
    if (!built.ok) {
      toast.error(built.message);
      return;
    }
    submit('edit', `Editada como «${built.literal}»`, built.literal);
  }, [editParts, shape, submit]);

  const chooseOption = useCallback(
    (option: ReadingOption) => submit('accept', `Lectura «${option.literal}»`, option.literal),
    [submit],
  );

  const acceptGroup = useCallback(() => {
    if (isReading) {
      if (proposal === null) return;
      submit('accept', `Lectura «${proposal}»`);
      return;
    }
    if (gradingProposal) {
      submit(
        gradingProposal,
        gradingProposal === 'mark_correct' ? 'Marcada correcta' : 'Marcada incorrecta',
      );
    }
  }, [isReading, proposal, gradingProposal, submit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return;
      const key = e.key.toUpperCase();
      const run = (action: () => void) => {
        e.preventDefault();
        action();
      };

      if (e.key === 'Enter' || e.key === 'ArrowRight') return run(onNext);
      if (e.key === 'ArrowLeft') return run(onPrev);
      if (key === 'U') return run(() => canUndo && !pending && onUndo());
      if (disabled) return;
      if (key === 'E') return run(startEdit);
      if (key === 'A') return run(acceptGroup);

      if (isReading) {
        const digit = Number.parseInt(e.key, 10);
        const option = Number.isInteger(digit) && digit >= 1 ? options[digit - 1] : undefined;
        if (option) return run(() => chooseOption(option));
        if (key === 'I') return run(() => submit('illegible', 'Ilegible'));
        if (key === 'B') return run(() => submit('blank', 'En blanco'));
        if (key === 'T') return run(() => submit('crossed_out', 'Tachada'));
        return;
      }

      if (key === 'C') return run(() => submit('mark_correct', 'Marcada correcta'));
      if (key === 'X') return run(() => submit('mark_incorrect', 'Marcada incorrecta'));
    },
    [
      onNext,
      onPrev,
      canUndo,
      pending,
      onUndo,
      disabled,
      startEdit,
      acceptGroup,
      isReading,
      options,
      chooseOption,
      submit,
    ],
  );

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="group"
      aria-label={`Grupo ${position} de ${total}: pregunta ${group.printedNumber}, ${group.size} ${group.size === 1 ? 'respuesta' : 'respuestas'}`}
      onKeyDown={handleKeyDown}
      className="space-y-4 rounded-lg border p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <GroupHeader group={group} position={position} total={total} included={included.length} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <CropPreview
            cropUrl={focused?.cropUrl ?? null}
            printedNumber={group.printedNumber}
            excluded={focused ? excluded.has(focused.decisionId) : false}
          />
          {focused && group.members.length > 1 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => toggleExcluded(focused.decisionId)}
            >
              {excluded.has(focused.decisionId) ? (
                <>
                  <UserPlus className="mr-2 size-4" aria-hidden />
                  Volver a incluir en el grupo
                </>
              ) : (
                <>
                  <UserMinus className="mr-2 size-4" aria-hidden />
                  Quitar del grupo
                </>
              )}
            </Button>
          )}
          <Thumbnails
            group={group}
            focusedIndex={focusedIndex}
            excluded={excluded}
            onFocus={setFocusedIndex}
            onToggle={toggleExcluded}
          />
        </div>

        <div className="space-y-4">
          <p className="text-base font-medium text-foreground">
            {REVIEW_MODE_QUESTIONS[group.mode]}
          </p>
          {proposal !== null && (
            <p className="text-sm text-muted-foreground">
              {isReading ? 'Lectura propuesta' : 'Respuesta leída'}:{' '}
              <span className="font-mono text-base font-semibold text-foreground">{proposal}</span>
            </p>
          )}

          <ReadersList group={group} />

          {!isReading && group.grading && <GradingContextView grading={group.grading} />}

          {editParts ? (
            <EditAnswerField
              shape={shape}
              parts={editParts}
              pending={pending}
              onChange={setEditParts}
              onSubmit={saveEdit}
              onCancel={cancelEdit}
            />
          ) : isReading ? (
            <ReadingActions
              options={options}
              canAccept={proposal !== null}
              disabled={disabled}
              onChoose={chooseOption}
              onAccept={acceptGroup}
              onEdit={startEdit}
              onSubmit={submit}
            />
          ) : (
            <GradingActions
              proposalAction={gradingProposal}
              disabled={disabled}
              onAccept={acceptGroup}
              onEdit={startEdit}
              onSubmit={submit}
            />
          )}

          {included.length === 0 && (
            <p className="text-sm text-warning">
              Quitaste todas las respuestas del grupo: vuelve a incluir alguna para decidir.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onPrev}
          disabled={position <= 1}
          aria-label="Ir al grupo anterior"
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
          onClick={onNext}
          disabled={position >= total}
          aria-label="Ir al grupo siguiente"
        >
          Siguiente
          <ArrowRight className="ml-2 size-4" aria-hidden />
        </Button>
      </div>

      <ShortcutLegend isReading={isReading} />
    </div>
  );
}

function GroupHeader({
  group,
  position,
  total,
  included,
}: {
  group: ReviewQueueGroup;
  position: number;
  total: number;
  included: number;
}) {
  const shown = group.members.length;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-foreground">
            Pregunta {group.printedNumber}
          </h3>
          <span className="text-sm text-muted-foreground">{group.formatLabel}</span>
          <StatusBadge tone={group.mode === 'reading' ? 'info' : 'warning'}>
            {REVIEW_MODE_LABELS[group.mode]}
          </StatusBadge>
        </div>
        <span className="text-xs text-muted-foreground">
          Grupo {position} de {total}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        {group.size} {group.size === 1 ? 'respuesta' : 'respuestas'}
        {shown < group.size ? ` · se muestran ${shown}` : ''}
        {included < shown ? ` · ${included} seleccionadas` : ''}
      </p>
      {group.reasons.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Motivos de la revisión">
          {group.reasons.map((reason) => (
            <li key={reason}>
              <Badge variant="outline" className="font-normal">
                {REVIEW_REASON_LABELS[reason]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CropPreview({
  cropUrl,
  printedNumber,
  excluded,
}: {
  cropUrl: string | null;
  printedNumber: string;
  excluded: boolean;
}) {
  return (
    <div
      className={cn(
        'flex min-h-48 items-center justify-center rounded-md border bg-muted/40 p-2',
        excluded && 'opacity-50',
      )}
    >
      {cropUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cropUrl}
          alt={`Recorte de la respuesta a la pregunta ${printedNumber}`}
          className="max-h-72 w-auto rounded bg-card"
        />
      ) : (
        <CropUnavailable />
      )}
    </div>
  );
}

function CropUnavailable({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 text-muted-foreground">
      <ImageOff className={compact ? 'size-4' : 'size-6'} aria-hidden />
      <span className={compact ? 'text-2xs' : 'text-xs'}>Recorte no disponible</span>
    </div>
  );
}

function Thumbnails({
  group,
  focusedIndex,
  excluded,
  onFocus,
  onToggle,
}: {
  group: ReviewQueueGroup;
  focusedIndex: number;
  excluded: ReadonlySet<string>;
  onFocus: (index: number) => void;
  onToggle: (decisionId: string) => void;
}) {
  if (group.members.length <= 1) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        Clic para ampliar · Shift+clic para quitar o volver a incluir en el grupo
      </p>
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {group.members.map((member, index) => {
          const isExcluded = excluded.has(member.decisionId);
          return (
            <li key={member.decisionId}>
              <button
                type="button"
                onClick={(e) => (e.shiftKey ? onToggle(member.decisionId) : onFocus(index))}
                aria-pressed={index === focusedIndex}
                aria-label={`Respuesta ${index + 1} de ${group.members.length}${isExcluded ? ', quitada del grupo' : ''}${member.isAudit ? ', muestra de auditoría' : ''}`}
                className={cn(
                  'relative flex h-16 w-full items-center justify-center overflow-hidden rounded border bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  index === focusedIndex && 'border-primary ring-1 ring-primary',
                  isExcluded && 'border-dashed opacity-40',
                )}
              >
                {member.cropUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={member.cropUrl} alt="" className="max-h-full w-auto" />
                ) : (
                  <CropUnavailable compact />
                )}
                {isExcluded && (
                  <span className="absolute inset-x-0 bottom-0 bg-background/90 text-2xs text-foreground">
                    Quitada
                  </span>
                )}
                {member.isAudit && !isExcluded && (
                  <span className="absolute right-0.5 top-0.5 rounded bg-info/15 px-1 text-2xs text-info">
                    Auditoría
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ReadersList({ group }: { group: ReviewQueueGroup }) {
  if (group.readers.length === 0) {
    return <p className="text-sm text-muted-foreground">Ningún lector leyó esta respuesta.</p>;
  }
  return (
    <ul className="space-y-2" aria-label="Lecturas de cada lector">
      {group.readers.map((reader) => (
        <li key={reader.readingId} className="rounded-md border p-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-foreground">{reader.model}</span>
            <span className="font-mono text-base text-foreground">
              {reader.literal ??
                (reader.state ? READING_STATE_LABELS[reader.state] : 'sin lectura')}
            </span>
            <span className="text-xs text-muted-foreground">
              confianza {formatConfidence(reader.confidence)}
            </span>
            {reader.state && reader.state !== 'answered' && reader.literal && (
              <Badge variant="secondary" className="font-normal">
                {READING_STATE_LABELS[reader.state]}
              </Badge>
            )}
            {reader.reviewRequested && (
              <Badge variant="warning" className="font-normal">
                Pidió revisión
              </Badge>
            )}
          </div>
          {reader.alternatives.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Alternativas:{' '}
              {reader.alternatives
                .map((alt) => `${alt.literal} (${formatConfidence(alt.plausibility)})`)
                .join(' · ')}
            </p>
          )}
          {reader.notes && <p className="mt-1 text-xs text-muted-foreground">{reader.notes}</p>}
        </li>
      ))}
    </ul>
  );
}

function GradingContextView({ grading }: { grading: GradingContext }) {
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm" aria-label="Clave">
      <p>
        <span className="text-muted-foreground">Clave: </span>
        <span className="font-mono font-semibold text-foreground">
          {grading.acceptedAnswers.length > 0 ? grading.acceptedAnswers.join(' o ') : 'sin clave'}
        </span>
        {grading.unit && <span className="text-muted-foreground"> · unidad {grading.unit}</span>}
      </p>
      {grading.proposedOutcome && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Propuesta:</span>
          <StatusBadge tone={SCORING_OUTCOME_TONES[grading.proposedOutcome]}>
            {SCORING_OUTCOME_LABELS[grading.proposedOutcome]}
          </StatusBadge>
        </div>
      )}
      {grading.optionOutcomes.length > 0 && (
        <ul className="space-y-1" aria-label="Resultado de cada opción">
          {grading.optionOutcomes.map((option) => (
            <li key={option.literal} className="flex items-center gap-2">
              <span className="font-mono text-foreground">{option.literal}</span>
              <StatusBadge tone={SCORING_OUTCOME_TONES[option.outcome]}>
                {SCORING_OUTCOME_LABELS[option.outcome]}
              </StatusBadge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReadingActions({
  options,
  canAccept,
  disabled,
  onChoose,
  onAccept,
  onEdit,
  onSubmit,
}: {
  options: ReadingOption[];
  canAccept: boolean;
  disabled: boolean;
  onChoose: (option: ReadingOption) => void;
  onAccept: () => void;
  onEdit: () => void;
  onSubmit: (action: ReviewAction, label: string) => void;
}) {
  return (
    <div className="space-y-3">
      {options.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option, index) => (
            <Button
              key={option.literal}
              type="button"
              variant="outline"
              className="h-auto min-h-11 justify-start whitespace-normal py-2 text-left"
              disabled={disabled}
              aria-label={`Aceptar la lectura ${option.literal} (tecla ${index + 1})`}
              onClick={() => onChoose(option)}
            >
              <Kbd className="mr-2 shrink-0">{index + 1}</Kbd>
              <span className="flex flex-col">
                <span className="font-mono text-base font-semibold">{option.literal}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {option.sources.join(' · ')}
                </span>
              </span>
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={disabled || !canAccept}
          onClick={onAccept}
          aria-label="Aceptar la lectura propuesta para todo el grupo (tecla A)"
        >
          <Check className="mr-2 size-4" aria-hidden />
          Aceptar grupo
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={onEdit}
          aria-label="Escribir la respuesta (tecla E)"
        >
          <Pencil className="mr-2 size-4" aria-hidden />
          Editar
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => onSubmit('illegible', 'Ilegible')}
          aria-label="Marcar como ilegible (tecla I)"
        >
          <EyeOff className="mr-2 size-4" aria-hidden />
          Ilegible
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => onSubmit('blank', 'En blanco')}
          aria-label="Marcar como en blanco (tecla B)"
        >
          <CircleOff className="mr-2 size-4" aria-hidden />
          En blanco
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => onSubmit('crossed_out', 'Tachada')}
          aria-label="Marcar como tachada (tecla T)"
        >
          <Strikethrough className="mr-2 size-4" aria-hidden />
          Tachada
        </Button>
      </div>
    </div>
  );
}

function GradingActions({
  proposalAction,
  disabled,
  onAccept,
  onEdit,
  onSubmit,
}: {
  proposalAction: ReviewAction | null;
  disabled: boolean;
  onAccept: () => void;
  onEdit: () => void;
  onSubmit: (action: ReviewAction, label: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        disabled={disabled}
        onClick={() => onSubmit('mark_correct', 'Marcada correcta')}
        aria-label="Marcar como correcta (tecla C)"
      >
        <Check className="mr-2 size-4" aria-hidden />
        Correcta
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => onSubmit('mark_incorrect', 'Marcada incorrecta')}
        aria-label="Marcar como incorrecta (tecla X)"
      >
        <X className="mr-2 size-4" aria-hidden />
        Incorrecta
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={onEdit}
        aria-label="Corregir lo que se leyó (tecla E)"
      >
        <Pencil className="mr-2 size-4" aria-hidden />
        Editar
      </Button>
      {proposalAction && (
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={onAccept}
          aria-label="Aceptar la propuesta para todo el grupo (tecla A)"
        >
          Aceptar propuesta
        </Button>
      )}
    </div>
  );
}

function ShortcutLegend({ isReading }: { isReading: boolean }) {
  return (
    <p className="hidden flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:flex">
      {isReading ? (
        <>
          <Kbd>1…9</Kbd> elegir lectura · <Kbd>A</Kbd> aceptar grupo · <Kbd>E</Kbd> editar ·{' '}
          <Kbd>I</Kbd> ilegible · <Kbd>B</Kbd> en blanco · <Kbd>T</Kbd> tachada ·
        </>
      ) : (
        <>
          <Kbd>C</Kbd> correcta · <Kbd>X</Kbd> incorrecta · <Kbd>A</Kbd> aceptar propuesta ·{' '}
          <Kbd>E</Kbd> editar ·
        </>
      )}
      <Kbd>Enter</Kbd> siguiente · <Kbd>←</Kbd> anterior · <Kbd>U</Kbd> deshacer
    </p>
  );
}
