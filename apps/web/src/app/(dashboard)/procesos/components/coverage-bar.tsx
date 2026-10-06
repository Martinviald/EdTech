import { cn } from '@/lib/utils';
import type { ProcessCoverageTotals } from '@soe/types';

const SEGMENTS = [
  { key: 'complete', label: 'Completas', className: 'bg-success' },
  { key: 'partial', label: 'Carga incompleta', className: 'bg-warning' },
  { key: 'scheduled', label: 'Sin respuestas', className: 'bg-info' },
  { key: 'missing', label: 'Sin evaluación', className: 'bg-muted-foreground/30' },
] as const;

export function CoverageBar({
  totals,
  showLegend = false,
  className,
}: {
  totals: ProcessCoverageTotals;
  showLegend?: boolean;
  className?: string;
}) {
  if (totals.expected === 0) return null;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="bg-muted flex h-2 w-full overflow-hidden rounded-full">
        {SEGMENTS.map((segment) => {
          const value = totals[segment.key];
          if (value === 0) return null;
          return (
            <div
              key={segment.key}
              className={segment.className}
              style={{ width: `${(value / totals.expected) * 100}%` }}
              title={`${segment.label}: ${value}`}
            />
          );
        })}
      </div>
      {showLegend && (
        <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {SEGMENTS.map((segment) => (
            <li key={segment.key} className="flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', segment.className)} aria-hidden />
              {segment.label}: {totals[segment.key]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
