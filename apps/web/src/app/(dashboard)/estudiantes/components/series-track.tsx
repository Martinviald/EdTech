import { ArrowRight, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { StudentPanoramaSeries, StudentPanoramaSeriesPoint } from '@soe/types';
import { cn } from '@/lib/utils';
import { PerformanceBadge } from '../../resultados/components/performance-badge';
import { formatAchievement } from '../../resultados/components/performance-level';

const SERIES_KIND_LABEL: Record<StudentPanoramaSeries['kind'], string> = {
  period_series: 'Momentos del año',
  instrument_family: 'Mismo instrumento, año a año',
};

type Trend = { delta: number; label: string; direction: 'up' | 'down' | 'flat' };

function trend(points: StudentPanoramaSeriesPoint[]): Trend | null {
  const withPct = points.filter((p) => p.achievement !== null);
  if (withPct.length < 2) return null;
  const previous = withPct[withPct.length - 2]!.achievement!;
  const last = withPct[withPct.length - 1]!.achievement!;
  const delta = Number((last - previous).toFixed(1));
  if (delta === 0) return { delta, label: 'sin cambio', direction: 'flat' };
  return {
    delta,
    label: `${delta > 0 ? '+' : ''}${delta} pp`,
    direction: delta > 0 ? 'up' : 'down',
  };
}

const TREND_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus } as const;
const TREND_CLASS = {
  up: 'text-level-adequate-foreground',
  down: 'text-level-insufficient-foreground',
  flat: 'text-muted-foreground',
} as const;

/**
 * Una serie comparable, punto a punto. Deliberadamente NO promedia: el eje X es el
 * momento del ciclo o el año, y entre puntos se lee el delta (última vs anterior),
 * nunca una media.
 */
export function SeriesTrack({ series }: { series: StudentPanoramaSeries }) {
  const t = trend(series.points);
  const TrendIcon = t ? TREND_ICON[t.direction] : null;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {SERIES_KIND_LABEL[series.kind]} · {series.label}
        </p>
        {t && TrendIcon ? (
          <span
            className={cn('inline-flex items-center gap-1 text-xs font-semibold', TREND_CLASS[t.direction])}
          >
            <TrendIcon className="size-3.5" aria-hidden />
            <span className="tabular-nums">{t.label}</span>
            <span className="font-normal text-muted-foreground">vs. anterior</span>
          </span>
        ) : null}
      </div>

      <ol className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2">
        {series.points.map((point, index) => {
          const isLast = index === series.points.length - 1;
          return (
            <li key={point.assessmentId} className="flex items-center gap-2">
              {index > 0 ? (
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              ) : null}
              <span
                className={cn(
                  'flex flex-col rounded-md px-1.5 py-0.5',
                  isLast && 'bg-background ring-1 ring-border',
                )}
              >
                <span className="text-2xs uppercase tracking-wide text-muted-foreground">
                  {point.label}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-medium tabular-nums">
                    {formatAchievement(point.achievement)}
                  </span>
                  <PerformanceBadge level={point.performanceLevel} band={point.performanceBand} />
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
