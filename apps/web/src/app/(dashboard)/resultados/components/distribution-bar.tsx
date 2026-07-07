import type {
  PerformanceBandDistributionBucket,
  PerformanceBandView,
  PerformanceDistributionBucket,
} from '@soe/types';
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
 * conteos. Sin estado → Server Component.
 *
 * Dos modos:
 *  - Por defecto: los 4 niveles DIA legacy (colores estáticos), como siempre.
 *  - Cuando llegan `bands` + `bandDistribution` (scope = un único instrumento con
 *    bandas configuradas), renderiza las N bandas reales del instrumento (ej. DIA
 *    I/II/III) con sus colores propios.
 */
export function DistributionBar({
  distribution,
  bands,
  bandDistribution,
  title = 'Distribución por nivel de desempeño',
}: {
  distribution: PerformanceDistributionBucket[];
  bands?: PerformanceBandView[];
  bandDistribution?: PerformanceBandDistributionBucket[];
  title?: string;
}) {
  const bandMode = Boolean(bands && bands.length > 0 && bandDistribution);

  const buckets = bandMode
    ? [...bandDistribution!].sort((a, b) => a.order - b.order)
    : null;

  const total = bandMode
    ? buckets!.reduce((acc, b) => acc + b.count, 0)
    : distribution.reduce((acc, b) => acc + b.count, 0);

  const byLevel = new Map(distribution.map((b) => [b.level, b]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {bandMode ? (
          <>
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
              {buckets!.map((b) => {
                if (b.percentage <= 0) return null;
                return (
                  <div
                    key={b.key}
                    className="h-full"
                    style={{ width: `${b.percentage}%`, backgroundColor: b.color ?? '#94a3b8' }}
                    title={`${b.label}: ${b.percentage.toFixed(1)}%`}
                  />
                );
              })}
            </div>

            <ul className="flex flex-wrap gap-x-6 gap-y-3">
              {buckets!.map((b) => (
                <li key={b.key} className="space-y-1">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: b.color ?? '#94a3b8' }}
                    />
                    {b.label}
                  </span>
                  <p className="text-sm font-medium">
                    {b.count}{' '}
                    <span className="text-muted-foreground">({b.percentage.toFixed(1)}%)</span>
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
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
          </>
        )}

        <p className="text-xs text-muted-foreground">Total clasificado: {total}</p>
      </CardContent>
    </Card>
  );
}
