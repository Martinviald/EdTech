import type { PerformanceDistributionBucket } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  PERFORMANCE_LEVEL_BAR_CLASS,
  PERFORMANCE_LEVEL_BADGE_CLASS,
  PERFORMANCE_LEVEL_LABELS,
  PERFORMANCE_LEVEL_ORDER,
} from './performance-level';
import { cn } from '@/lib/utils';

/**
 * Distribución de niveles de desempeño (H6.4): barra apilada + leyenda con
 * conteos. Sin estado → Server Component. La codificación de color por nivel
 * es la misma que en los badges.
 */
export function DistributionBar({
  distribution,
  title = 'Distribución por nivel de desempeño',
}: {
  distribution: PerformanceDistributionBucket[];
  title?: string;
}) {
  const byLevel = new Map(distribution.map((b) => [b.level, b]));
  const total = distribution.reduce((acc, b) => acc + b.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
          {PERFORMANCE_LEVEL_ORDER.map((level) => {
            const bucket = byLevel.get(level);
            const pct = bucket?.percentage ?? 0;
            if (pct <= 0) return null;
            return (
              <div
                key={level}
                className={cn('h-full', PERFORMANCE_LEVEL_BAR_CLASS[level])}
                style={{ width: `${pct}%` }}
                title={`${PERFORMANCE_LEVEL_LABELS[level]}: ${pct.toFixed(1)}%`}
              />
            );
          })}
        </div>

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PERFORMANCE_LEVEL_ORDER.map((level) => {
            const bucket = byLevel.get(level);
            const count = bucket?.count ?? 0;
            const pct = bucket?.percentage ?? 0;
            return (
              <li key={level} className="space-y-1">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
                    PERFORMANCE_LEVEL_BADGE_CLASS[level],
                  )}
                >
                  {PERFORMANCE_LEVEL_LABELS[level]}
                </span>
                <p className="text-sm font-medium">
                  {count} <span className="text-muted-foreground">({pct.toFixed(1)}%)</span>
                </p>
              </li>
            );
          })}
        </ul>

        <p className="text-xs text-muted-foreground">Total clasificado: {total}</p>
      </CardContent>
    </Card>
  );
}
