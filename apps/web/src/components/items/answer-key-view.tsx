'use client';

import { useState, type JSX } from 'react';
import { CheckCircle2, FileQuestion, ListChecks, ScrollText } from 'lucide-react';
import type { AnswerKey, AnswerKeyAlternative } from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MatchingContentView } from './matching-content-view';
import { TrueFalseContentView } from './true-false-content-view';
import { RubricDialog } from './rubric-dialog';

// ─────────────────────────────────────────────────────────────────────────────
// Vista docente de la clave / respuesta correcta de una pregunta, para cualquier
// `item_type`. Consume el `AnswerKey` normalizado por `deriveAnswerKey`, así que
// el mismo componente sirve al banco (Panel A, con el `content` crudo) y a
// resultados (Panel B, con la clave que expone la API). Cuando el ítem se evalúa
// con una rúbrica, ofrece un botón que abre el modal de pauta.
// ─────────────────────────────────────────────────────────────────────────────

export function AnswerKeyView({
  answerKey,
  itemId,
  imageAltKeys,
}: {
  answerKey: AnswerKey;
  itemId: string;
  /** Keys de alternativas que son imágenes (scoringConfig.altImageRefs). Solo Panel A. */
  imageAltKeys?: Set<string>;
}): JSX.Element {
  switch (answerKey.kind) {
    case 'choice':
    case 'multi_choice':
      return (
        <ul className="space-y-2">
          {answerKey.alternatives.map((alt) => (
            <AlternativeRow
              key={alt.key}
              alt={alt}
              itemId={itemId}
              hasImage={imageAltKeys?.has(alt.key) ?? false}
            />
          ))}
        </ul>
      );
    case 'true_false':
      return <TrueFalseContentView correctAnswer={answerKey.correctAnswer} />;
    case 'matching':
      return (
        <MatchingContentView
          content={{
            leftItems: answerKey.leftItems,
            rightItems: answerKey.rightItems,
            correctPairs: answerKey.correctPairs,
          }}
        />
      );
    case 'ordering':
      return <OrderingView items={answerKey.items} correctOrder={answerKey.correctOrder} />;
    case 'short_answer':
      return <AcceptedAnswersView answers={answerKey.acceptedAnswers} />;
    case 'gap_fill':
      return (
        <ul className="space-y-2">
          {answerKey.gaps.map((gap) => (
            <li key={gap.position} className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
              <span className="mr-2 font-mono text-xs text-muted-foreground">
                Espacio {gap.position + 1}
              </span>
              {gap.acceptedAnswers.join(' · ')}
            </li>
          ))}
        </ul>
      );
    case 'sample_answer':
      return (
        <SampleAnswerView sampleAnswer={answerKey.sampleAnswer} rubricId={answerKey.rubricId} />
      );
    case 'rubric_levels':
      return <RubricLevelsView levels={answerKey.levels} rubricId={answerKey.rubricId} />;
    case 'none':
    default:
      return <EmptyKey />;
  }
}

function EmptyKey(): JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
      <FileQuestion className="size-5" aria-hidden />
      <span>Esta pregunta no tiene una clave registrada.</span>
    </div>
  );
}

function AlternativeRow({
  alt,
  itemId,
  hasImage,
}: {
  alt: AnswerKeyAlternative;
  itemId: string;
  hasImage: boolean;
}): JSX.Element {
  return (
    <li
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm',
        alt.isCorrect ? 'border-success/60 bg-success/10' : 'border-border',
      )}
    >
      <span
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
          alt.isCorrect ? 'border-success text-success' : 'border-border text-muted-foreground',
        )}
      >
        {alt.key}
      </span>
      {hasImage ? (
        // La alternativa ES una imagen: se muestra la figura, no el `text` (que es una
        // descripción de IA y filtraría la respuesta).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/items/${itemId}/alternativa/${alt.key}/figura`}
          alt={alt.text ?? `Alternativa ${alt.key}`}
          className="min-w-0 flex-1 max-h-48 rounded-md border bg-white object-contain"
        />
      ) : (
        <span className="min-w-0 flex-1 text-foreground">
          {alt.text ?? `Alternativa ${alt.key}`}
        </span>
      )}
      {alt.isCorrect ? (
        <CheckCircle2
          className="mt-0.5 size-4 shrink-0 text-success"
          aria-label="Alternativa correcta"
        />
      ) : null}
    </li>
  );
}

function OrderingView({
  items,
  correctOrder,
}: {
  items: { id: string; text: string }[];
  correctOrder: string[];
}): JSX.Element {
  const textById = new Map(items.map((it) => [it.id, it.text]));
  return (
    <ol className="space-y-1.5">
      {correctOrder.map((id, index) => (
        <li
          key={id}
          className="flex items-center gap-2.5 rounded-md border bg-muted/20 px-3 py-2 text-sm"
        >
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold text-muted-foreground">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 text-foreground">{textById.get(id) ?? id}</span>
        </li>
      ))}
    </ol>
  );
}

function AcceptedAnswersView({ answers }: { answers: string[] }): JSX.Element {
  if (answers.length === 0) return <EmptyKey />;
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-2">
        {answers.map((answer, i) => (
          <li key={i}>
            <Badge variant="success" className="font-normal">
              {answer}
            </Badge>
          </li>
        ))}
      </ul>
      {answers.length > 1 ? (
        <p className="text-xs text-muted-foreground">
          Se acepta cualquiera de estas variantes como respuesta correcta.
        </p>
      ) : null}
    </div>
  );
}

function SampleAnswerView({
  sampleAnswer,
  rubricId,
}: {
  sampleAnswer: string | null;
  rubricId: string | null;
}): JSX.Element {
  return (
    <div className="space-y-3">
      {sampleAnswer ? (
        <div className="rounded-md border bg-muted/20 p-3">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ScrollText className="size-3.5" aria-hidden />
            Respuesta modelo
          </p>
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
            {sampleAnswer}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Esta pregunta es de desarrollo: su corrección se realiza con una pauta.
        </p>
      )}
      {rubricId ? <ViewRubricButton rubricId={rubricId} /> : null}
    </div>
  );
}

function RubricLevelsView({
  levels,
  rubricId,
}: {
  levels: {
    code: string;
    label: string | null;
    descriptor: string | null;
    creditFraction: number;
  }[];
  rubricId: string | null;
}): JSX.Element {
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {levels.map((level) => (
          <li key={level.code} className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{level.label ?? level.code}</Badge>
              <span className="text-xs tabular-nums text-muted-foreground">
                {Math.round(level.creditFraction * 100)}% del puntaje
              </span>
            </div>
            {level.descriptor ? (
              <p className="mt-1 text-muted-foreground">{level.descriptor}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {rubricId ? <ViewRubricButton rubricId={rubricId} /> : null}
    </div>
  );
}

function ViewRubricButton({ rubricId }: { rubricId: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <ListChecks className="size-4" aria-hidden />
        Ver pauta
      </Button>
      <RubricDialog rubricId={rubricId} open={open} onOpenChange={setOpen} />
    </>
  );
}
