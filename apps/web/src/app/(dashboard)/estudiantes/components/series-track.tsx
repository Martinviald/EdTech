import { ArrowRight } from 'lucide-react';
import type { StudentPanoramaSeries, StudentPanoramaSeriesPoint } from '@soe/types';
import { PerformanceBadge } from '../../resultados/components/performance-badge';
import { formatAchievement } from '../../resultados/components/performance-level';

const SERIES_KIND_LABEL: Record<StudentPanoramaSeries['kind'], string> = {
  period_series: 'Momentos del año',
  instrument_family: 'Mismo instrumento, año a año',
};

function deltaLabel(points: StudentPanoramaSeriesPoint[]): string | null {
  const withPct = points.filter((p) => p.achievement !== null);
  if (withPct.length < 2) return null;
  const first = withPct[0]!.achievement!;
  const last = withPct[withPct.length - 1]!.achievement!;
  const delta = Number((last - first).toFixed(1));
  if (delta === 0) return 'sin cambio';
  return `${delta > 0 ? '+' : ''}${delta} pp`;
}

/**
 * Una serie comparable, punto a punto. Deliberadamente NO promedia: el eje X es el
 * momento del ciclo o el año, y entre puntos se lee el delta, nunca una media.
 */
export function SeriesTrack({ series }: { series: StudentPanoramaSeries }) {
  const delta = deltaLabel(series.points);

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {SERIES_KIND_LABEL[series.kind]} · {series.label}
        </p>
        {delta ? <span className="text-xs font-semibold tabular-nums">{delta}</span> : null}
      </div>

      <ol className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2">
        {series.points.map((point, index) => (
          <li key={point.assessmentId} className="flex items-center gap-2">
            {index > 0 ? (
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            ) : null}
            <span className="flex flex-col">
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
        ))}
      </ol>
    </div>
  );
}
