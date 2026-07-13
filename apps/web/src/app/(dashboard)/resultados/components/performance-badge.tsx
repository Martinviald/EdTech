import type { PerformanceLevel } from '@soe/types';
import { cn } from '@/lib/utils';
import {
  PERFORMANCE_LEVEL_BADGE_CLASS,
  bandLabel,
  performanceLevelLabel,
  type PerformanceBandView,
} from './performance-level';

/**
 * Badge de nivel de desempeño con color consistente (H6.4). Server-friendly
 * (sin estado): se usa en tablas y cards de cualquier página de resultados.
 *
 * Si el resultado trae `band` (nivel real del instrumento, ej. DIA I/II/III), se
 * muestra su etiqueta; el color se toma del enum legacy `level` (band-derivado)
 * que sigue siendo el mapa de colores canónico. Sin band, comportamiento previo.
 */
export function PerformanceBadge({
  level,
  band,
  className,
}: {
  level: PerformanceLevel | null;
  band?: PerformanceBandView | null;
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
      {band ? bandLabel(band, level) : performanceLevelLabel(level)}
    </span>
  );
}
