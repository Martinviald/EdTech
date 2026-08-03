import type { JSX } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { TRUE_FALSE_LABELS, isTrueFalseContent } from '@soe/types';

import { cn } from '@/lib/utils';

/**
 * Vista docente de un ítem Verdadero/Falso. Su `content` no lleva `alternatives`
 * —la respuesta es un booleano— así que el render por alternativas lo mostraría
 * vacío. Se pintan las dos opciones marcando la correcta, igual que un ítem de
 * selección, para que el panel se lea igual en todo el banco.
 */

export function asTrueFalseContent(
  content: Record<string, unknown>,
): { correctAnswer: boolean } | null {
  return isTrueFalseContent(content) ? content : null;
}

export function TrueFalseContentView({ correctAnswer }: { correctAnswer: boolean }): JSX.Element {
  return (
    <ul className="space-y-2">
      {[true, false].map((option) => {
        const isCorrect = option === correctAnswer;
        return (
          <li
            key={String(option)}
            className={cn(
              'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
              isCorrect ? 'border-success bg-success/5 text-foreground' : 'bg-muted/20',
            )}
          >
            <span className="font-mono text-xs text-muted-foreground">{option ? 'V' : 'F'}</span>
            <span className={cn(isCorrect && 'font-medium')}>
              {option ? TRUE_FALSE_LABELS.V : TRUE_FALSE_LABELS.F}
            </span>
            {isCorrect ? (
              <CheckCircle2
                className="ml-auto size-4 text-success"
                aria-label="Respuesta correcta"
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
