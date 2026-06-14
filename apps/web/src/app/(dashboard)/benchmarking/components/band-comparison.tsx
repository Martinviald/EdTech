import type { BenchmarkBandDistribution } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BENCHMARK_BAND_ORDER,
  BENCHMARK_BAND_LABELS,
  BENCHMARK_BAND_BAR_CLASS,
  BENCHMARK_BAND_BADGE_CLASS,
  bandPercentage,
  bandDistributionTotal,
} from './band-presentation';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// H7.5 — Distribución por banda comparada: tu colegio vs cohorte. Dos barras
// apiladas (una por grupo) + leyenda. Sin estado → Server Component. Colores via
// tokens Tailwind. La cohorte se muestra en proporciones agregadas (sin PII).
// ─────────────────────────────────────────────────────────────────────────────

function StackedBar({ dist }: { dist: BenchmarkBandDistribution }) {
  const total = bandDistributionTotal(dist);
  return (
    <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
      {total === 0
        ? null
        : BENCHMARK_BAND_ORDER.map((key) => {
            const pct = bandPercentage(dist, key);
            if (pct <= 0) return null;
            return (
              <div
                key={key}
                className={cn('h-full', BENCHMARK_BAND_BAR_CLASS[key])}
                style={{ width: `${pct}%` }}
                title={`${BENCHMARK_BAND_LABELS[key]}: ${pct.toFixed(1)}%`}
              />
            );
          })}
    </div>
  );
}

export function BandComparison({
  yourDistribution,
  cohortDistribution,
}: {
  yourDistribution: BenchmarkBandDistribution;
  cohortDistribution: BenchmarkBandDistribution;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Distribución por banda: tu colegio vs cohorte
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-foreground">Tu colegio</span>
          <StackedBar dist={yourDistribution} />
        </div>
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-muted-foreground">
            Cohorte (promedio del grupo)
          </span>
          <StackedBar dist={cohortDistribution} />
        </div>

        <ul className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
          {BENCHMARK_BAND_ORDER.map((key) => (
            <li key={key} className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
                  BENCHMARK_BAND_BADGE_CLASS[key],
                )}
              >
                {BENCHMARK_BAND_LABELS[key]}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
