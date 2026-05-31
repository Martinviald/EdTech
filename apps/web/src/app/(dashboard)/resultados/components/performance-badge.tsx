import type { PerformanceLevel } from '@soe/types';
import { cn } from '@/lib/utils';
import {
  PERFORMANCE_LEVEL_BADGE_CLASS,
  performanceLevelLabel,
} from './performance-level';

/**
 * Badge de nivel de desempeño con color consistente (H6.4). Server-friendly
 * (sin estado): se usa en tablas y cards de cualquier página de resultados.
 */
export function PerformanceBadge({
  level,
  className,
}: {
  level: PerformanceLevel | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        level
          ? PERFORMANCE_LEVEL_BADGE_CLASS[level]
          : 'border-border bg-muted text-muted-foreground',
        className,
      )}
    >
      {performanceLevelLabel(level)}
    </span>
  );
}
