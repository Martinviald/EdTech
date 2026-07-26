import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Step {
  /** Identificador estable del paso. */
  id: string;
  label: string;
}

interface StepperProps {
  steps: Step[];
  /** Índice (0-based) del paso actual. */
  currentStep: number;
  className?: string;
}

/**
 * Indicador de progreso horizontal para flujos multi-paso (p. ej. el wizard de
 * importación DIA). Estilo calmado, basado en tokens: paso activo en primary,
 * completado con check, pendiente en muted.
 */
export function Stepper({ steps, currentStep, className }: StepperProps) {
  return (
    <ol className={cn('flex items-center gap-2', className)} aria-label="Progreso">
      {steps.map((step, index) => {
        const isComplete = index < currentStep;
        const isCurrent = index === currentStep;

        return (
          <li key={step.id} className="flex flex-1 items-center gap-2">
            <span
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                isComplete && 'bg-primary text-primary-foreground',
                isCurrent && 'bg-primary text-primary-foreground ring-2 ring-primary/20',
                !isComplete && !isCurrent && 'bg-muted text-muted-foreground',
              )}
            >
              {isComplete ? <Check className="size-4" aria-hidden /> : index + 1}
            </span>
            <span
              className={cn(
                'hidden text-sm font-medium sm:inline',
                isCurrent ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {step.label}
            </span>
            {index < steps.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  'mx-1 h-px flex-1',
                  isComplete ? 'bg-primary' : 'bg-border',
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
