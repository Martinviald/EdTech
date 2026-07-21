import { ArrowDown, ArrowUp } from 'lucide-react';

import { cn } from '@/lib/utils';

export type MetricTrend = {
  /** Delta ya calculado (p. ej. 12 o -4.05). El signo define la flecha. */
  value: number;
  /** Si subir es "bueno" (verde). Default true; para métricas donde bajar es mejor, false. */
  higherIsBetter?: boolean;
  /** Formatea el valor absoluto del delta. Default: `${v}%`. */
  format?: (value: number) => string;
};

/** Chip de tendencia (flecha + delta) con color por bueno/malo. Compartido por StatCard y MetricsGroup. */
export function MetricTrendChip({ trend }: { trend: MetricTrend }) {
  const positive = trend.value >= 0;
  const good = positive === (trend.higherIsBetter ?? true);
  const format = trend.format ?? ((value: number) => `${Math.abs(value)}%`);
  const Arrow = positive ? ArrowUp : ArrowDown;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums',
        good ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive',
      )}
    >
      <Arrow className="size-3 shrink-0" aria-hidden />
      {format(trend.value)}
    </span>
  );
}
