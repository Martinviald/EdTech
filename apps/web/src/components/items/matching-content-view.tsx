import type { JSX } from 'react';
import { ArrowRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Vista docente de un ítem de términos pareados: las dos columnas y los pares
 * correctos. No es un componente de rendición (unir/arrastrar) — en F1 no hay
 * vista de alumno rindiendo.
 *
 * Es genérica por diseño: las columnas pueden tener tamaños distintos, el banco
 * puede traer distractores y una misma opción puede responder a varios
 * elementos. No asume el formato de ningún instrumento en particular.
 */

type MatchingElement = {
  id: string;
  text: string;
  label?: string;
  isImage?: boolean;
};

type MatchingPair = { leftId: string; rightId: string };

export type MatchingContentShape = {
  leftItems: MatchingElement[];
  rightItems: MatchingElement[];
  correctPairs: MatchingPair[];
};

/** Lee el `content` JSONB como un pareado, o `null` si no tiene esa forma. */
export function asMatchingContent(content: Record<string, unknown>): MatchingContentShape | null {
  const { leftItems, rightItems, correctPairs } = content as Partial<MatchingContentShape>;
  if (!Array.isArray(leftItems) || !Array.isArray(rightItems) || !Array.isArray(correctPairs)) {
    return null;
  }
  if (leftItems.length === 0 || rightItems.length === 0) return null;
  return { leftItems, rightItems, correctPairs };
}

export function MatchingContentView({
  content,
  compact = false,
}: {
  content: MatchingContentShape;
  compact?: boolean;
}): JSX.Element {
  const { leftItems, rightItems, correctPairs } = content;

  const optionById = new Map(rightItems.map((el) => [el.id, el]));
  const answeredOptionIds = new Set(correctPairs.map((p) => p.rightId));
  const answerByLeftId = new Map(correctPairs.map((p) => [p.leftId, p.rightId]));
  const distractors = rightItems.filter((el) => !answeredOptionIds.has(el.id));

  return (
    <div className={cn('space-y-4', compact && 'space-y-3')}>
      <ul className="space-y-2">
        {leftItems.map((element) => {
          const optionId = answerByLeftId.get(element.id);
          const option = optionId ? optionById.get(optionId) : undefined;
          return (
            <li
              key={element.id}
              className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-center"
            >
              <ElementCell element={element} className="flex-1" />
              <ArrowRight
                className="size-4 shrink-0 text-muted-foreground sm:mx-2"
                aria-hidden="true"
              />
              <div className="flex-1">
                {option ? (
                  <ElementCell element={option} highlighted />
                ) : (
                  <span className="text-sm text-muted-foreground">Sin par declarado</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {distractors.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Opciones del banco que no corresponden a ningún elemento (distractores)
          </p>
          <ul className="flex flex-wrap gap-2">
            {distractors.map((element) => (
              <li key={element.id}>
                <Badge variant="secondary" className="font-normal">
                  {element.label ? `${element.label}. ` : ''}
                  {element.isImage ? `[Figura] ${element.text}` : element.text}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ElementCell({
  element,
  className,
  highlighted = false,
}: {
  element: MatchingElement;
  className?: string;
  highlighted?: boolean;
}): JSX.Element {
  return (
    <div className={cn('flex items-start gap-2 text-sm', className)}>
      {element.label ? (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{element.label}</span>
      ) : null}
      <span className={cn('leading-relaxed', highlighted && 'font-medium text-foreground')}>
        {element.isImage ? (
          <span className="text-muted-foreground">[Figura] {element.text}</span>
        ) : (
          element.text
        )}
      </span>
    </div>
  );
}
