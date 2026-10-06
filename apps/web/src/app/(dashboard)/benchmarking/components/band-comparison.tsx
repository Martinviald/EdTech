import type { BenchmarkBandCount } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  bandBadgeClass,
  bandBarClass,
  bandPercentages,
  unionBands,
  type BenchmarkBandRef,
} from './band-presentation';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// H7.5 — Distribución por banda comparada: tu colegio vs cohorte, en los niveles
// propios del instrumento. Dos barras apiladas + leyenda. Sin estado → Server
// Component. La cohorte se muestra en proporciones agregadas (sin PII).
// ─────────────────────────────────────────────────────────────────────────────

function StackedBar({
  counts,
  bands,
}: {
  counts: readonly BenchmarkBandCount[];
  bands: readonly BenchmarkBandRef[];
}) {
  const percentages = bandPercentages(counts);
  return (
    <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
      {bands.map((band) => {
        const pct = percentages.get(band.bandKey) ?? 0;
        if (pct <= 0) return null;
        return (
          <div
            key={band.bandKey}
            className={cn('h-full', bandBarClass(band, bands))}
            style={{ width: `${pct}%` }}
            title={`${band.label}: ${pct.toFixed(1)}%`}
          />
        );
      })}
    </div>
  );
}

export function BandComparison({
  yourBandCounts,
  cohortBandCounts,
}: {
  yourBandCounts: BenchmarkBandCount[];
  cohortBandCounts: BenchmarkBandCount[];
}) {
  const bands = unionBands([yourBandCounts, cohortBandCounts]);
  if (bands.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Distribución por nivel: tu colegio vs cohorte</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-foreground">Tu colegio</span>
          <StackedBar counts={yourBandCounts} bands={bands} />
        </div>
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-muted-foreground">
            Cohorte (todos sus alumnos)
          </span>
          <StackedBar counts={cohortBandCounts} bands={bands} />
        </div>

        <ul className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
          {bands.map((band) => (
            <li key={band.bandKey} className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
                  bandBadgeClass(band, bands),
                )}
              >
                {band.label}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
