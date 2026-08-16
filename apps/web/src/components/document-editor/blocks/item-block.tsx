import { useState } from 'react';
import { ChevronDown, ChevronUp, FileQuestion, Pencil } from 'lucide-react';
import {
  ITEM_TYPE_LABELS,
  multipleChoiceContentSchema,
  openEndedContentSchema,
  shortAnswerContentSchema,
  trueFalseContentSchema,
  type DocumentItemSnapshot,
  type ItemBlock,
  type MultipleChoiceContent,
  type OpenEndedContent,
  type ShortAnswerContent,
  type TrueFalseContent,
} from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { BlockDefinition, BlockEditProps, BlockViewProps } from '../block-registry';

function readString(content: Record<string, unknown>, key: string): string | null {
  const value = content[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function snapshotStem(snapshot: DocumentItemSnapshot): string | null {
  return (
    readString(snapshot.content, 'stem') ??
    readString(snapshot.content, 'prompt') ??
    readString(snapshot.content, 'passage') ??
    readString(snapshot.content, 'textWithGaps')
  );
}

function AnswerLines({ count }: { count: number }) {
  return (
    <div className="space-y-7 pt-3" aria-hidden>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="border-b border-border" />
      ))}
    </div>
  );
}

function Explanation({ text }: { text?: string }) {
  if (!text?.trim()) return null;
  return (
    <p className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground">Explicación: </span>
      {text}
    </p>
  );
}

function ChoiceBody({
  content,
  isMultiSelect,
  showKey,
}: {
  content: MultipleChoiceContent;
  isMultiSelect: boolean;
  showKey: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="whitespace-pre-line text-sm leading-relaxed">{content.stem}</p>
      {isMultiSelect ? (
        <p className="text-xs text-muted-foreground">Marca todas las alternativas correctas.</p>
      ) : null}
      <ol className="grid gap-2 sm:grid-cols-2">
        {content.alternatives.map((alt) => {
          const highlight = showKey && alt.isCorrect;
          return (
            <li
              key={alt.key}
              className={cn(
                'flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm',
                highlight ? 'border-success/60 bg-success/10' : 'border-border',
              )}
            >
              <span
                className={cn(
                  'inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                  highlight ? 'border-success text-success' : 'border-border text-muted-foreground',
                )}
              >
                {alt.key}
              </span>
              <span className="min-w-0 flex-1">{alt.text}</span>
              {highlight ? <Badge variant="success">Correcta</Badge> : null}
            </li>
          );
        })}
      </ol>
      {showKey ? <Explanation text={content.explanation} /> : null}
    </div>
  );
}

function TrueFalseBody({ content, showKey }: { content: TrueFalseContent; showKey: boolean }) {
  const options = [
    { label: 'Verdadero', value: true },
    { label: 'Falso', value: false },
  ];
  return (
    <div className="space-y-3">
      <p className="whitespace-pre-line text-sm leading-relaxed">{content.stem}</p>
      <div className="flex gap-3">
        {options.map((option) => {
          const highlight = showKey && content.correctAnswer === option.value;
          return (
            <span
              key={option.label}
              className={cn(
                'inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm',
                highlight ? 'border-success/60 bg-success/10 font-medium' : 'border-border',
              )}
            >
              {option.label}
              {highlight ? <Badge variant="success">Correcta</Badge> : null}
            </span>
          );
        })}
      </div>
      {showKey ? <Explanation text={content.explanation} /> : null}
    </div>
  );
}

function ShortAnswerBody({ content, showKey }: { content: ShortAnswerContent; showKey: boolean }) {
  return (
    <div className="space-y-3">
      <p className="whitespace-pre-line text-sm leading-relaxed">{content.prompt}</p>
      <AnswerLines count={2} />
      {showKey ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Respuestas aceptadas:</span>
          {content.acceptedAnswers.map((answer, index) => (
            <Badge key={index} variant="success" className="font-normal">
              {answer}
              {content.unit ? ` ${content.unit}` : ''}
            </Badge>
          ))}
        </div>
      ) : null}
      {showKey ? <Explanation text={content.explanation} /> : null}
    </div>
  );
}

function OpenEndedBody({ content, showKey }: { content: OpenEndedContent; showKey: boolean }) {
  return (
    <div className="space-y-3">
      <p className="whitespace-pre-line text-sm leading-relaxed">{content.prompt}</p>
      <AnswerLines count={4} />
      {showKey && content.sampleAnswer ? (
        <div className="rounded-md border border-border bg-muted/20 p-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Respuesta modelo
          </p>
          <p className="whitespace-pre-line text-sm leading-relaxed">{content.sampleAnswer}</p>
        </div>
      ) : null}
      {showKey ? <Explanation text={content.explanation} /> : null}
    </div>
  );
}

function GenericBody({ snapshot }: { snapshot: DocumentItemSnapshot }) {
  const stem = snapshotStem(snapshot);
  return (
    <div className="space-y-3">
      {stem ? (
        <p className="whitespace-pre-line text-sm leading-relaxed">{stem}</p>
      ) : (
        <p className="text-sm italic text-muted-foreground">Ítem sin enunciado.</p>
      )}
      <AnswerLines count={3} />
    </div>
  );
}

function ItemSnapshotBody({
  snapshot,
  showKey,
}: {
  snapshot: DocumentItemSnapshot;
  showKey: boolean;
}) {
  switch (snapshot.type) {
    case 'multiple_choice':
    case 'multi_select': {
      const parsed = multipleChoiceContentSchema.safeParse(snapshot.content);
      if (parsed.success) {
        return (
          <ChoiceBody
            content={parsed.data}
            isMultiSelect={snapshot.type === 'multi_select'}
            showKey={showKey}
          />
        );
      }
      break;
    }
    case 'true_false': {
      const parsed = trueFalseContentSchema.safeParse(snapshot.content);
      if (parsed.success) return <TrueFalseBody content={parsed.data} showKey={showKey} />;
      break;
    }
    case 'short_answer': {
      const parsed = shortAnswerContentSchema.safeParse(snapshot.content);
      if (parsed.success) return <ShortAnswerBody content={parsed.data} showKey={showKey} />;
      break;
    }
    case 'open_ended': {
      const parsed = openEndedContentSchema.safeParse(snapshot.content);
      if (parsed.success) return <OpenEndedBody content={parsed.data} showKey={showKey} />;
      break;
    }
  }
  return <GenericBody snapshot={snapshot} />;
}

function ItemPrintView({ block, audience, itemNumber }: BlockViewProps<ItemBlock>) {
  // La versión profesor SIEMPRE lleva la pauta (respuestas correctas + explicación);
  // la del alumno nunca. No depende de un toggle por ítem.
  const showKey = audience === 'teacher';
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {itemNumber !== undefined ? `Pregunta ${itemNumber}` : 'Pregunta'}
        </p>
        {audience === 'teacher' ? (
          <Badge variant="outline">{ITEM_TYPE_LABELS[block.snapshot.type]}</Badge>
        ) : null}
      </div>
      <ItemSnapshotBody snapshot={block.snapshot} showKey={showKey} />
    </div>
  );
}

function ItemEditView({ block, onEditItem }: BlockEditProps<ItemBlock>) {
  const [expanded, setExpanded] = useState(false);
  const stem = snapshotStem(block.snapshot);
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant="outline">{ITEM_TYPE_LABELS[block.snapshot.type]}</Badge>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            icon={expanded ? ChevronUp : ChevronDown}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Ocultar' : 'Ver alternativas'}
          </Button>
          {onEditItem ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              icon={Pencil}
              onClick={() => onEditItem(block)}
            >
              Editar contenido
            </Button>
          ) : null}
        </div>
      </div>
      {expanded ? (
        <div className="rounded-md border border-border bg-background p-3">
          <ItemSnapshotBody snapshot={block.snapshot} showKey />
        </div>
      ) : stem ? (
        <p className="line-clamp-3 text-sm">{stem}</p>
      ) : (
        <p className="text-sm italic text-muted-foreground">Ítem sin enunciado.</p>
      )}
    </div>
  );
}

export const itemBlockDefinition: BlockDefinition<ItemBlock> = {
  label: 'Pregunta',
  icon: FileQuestion,
  // Placeholder: los bloques `item` reales los inserta el picker del banco (otra
  // fase); este default no referencia un ítem existente.
  makeDefault: () => ({
    id: crypto.randomUUID(),
    type: 'item',
    itemId: crypto.randomUUID(),
    snapshot: { type: 'multiple_choice', version: 0, content: {} },
  }),
  EditView: ItemEditView,
  PrintView: ItemPrintView,
};
