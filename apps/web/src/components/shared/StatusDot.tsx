import { cn } from '@/lib/utils';

import type { StatusTone } from './StatusBadge';

const TONE_TO_DOT = {
  success: 'bg-success',
  warning: 'bg-warning',
  info: 'bg-info',
  danger: 'bg-destructive',
  neutral: 'bg-muted-foreground',
} as const;

interface StatusDotProps {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}

/**
 * Estado inline: punto de color por token semántico + etiqueta (p. ej.
 * "● Ready"). Más liviano que `StatusBadge` para la fila de metadata de un
 * encabezado. Comparte los tonos de `StatusBadge`.
 */
export function StatusDot({ tone, children, className }: StatusDotProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-sm text-muted-foreground',
        className,
      )}
    >
      <span
        className={cn('size-2 shrink-0 rounded-full', TONE_TO_DOT[tone])}
        aria-hidden
      />
      {children}
    </span>
  );
}
