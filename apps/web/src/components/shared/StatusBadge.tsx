import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Tonos semánticos de estado. Mapean a las variantes tonales de `Badge`. */
export type StatusTone = 'success' | 'warning' | 'info' | 'neutral' | 'danger';

const TONE_TO_VARIANT = {
  success: 'success',
  warning: 'warning',
  info: 'info',
  danger: 'destructive',
  neutral: 'secondary',
} as const;

interface StatusBadgeProps {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}

/**
 * Badge de estado con color por token semántico. Reemplaza los mapas de
 * colores hardcodeados (`bg-emerald-100`, `bg-amber-100`, …) repartidos por la
 * app. El call-site decide el tono según su dominio (p. ej. published→success,
 * draft→warning, archived→neutral).
 */
export function StatusBadge({ tone, children, className }: StatusBadgeProps) {
  return (
    <Badge variant={TONE_TO_VARIANT[tone]} className={cn('font-medium', className)}>
      {children}
    </Badge>
  );
}
