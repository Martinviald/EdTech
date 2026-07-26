import type { LucideIcon } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { MetricTrendChip, type MetricTrend } from './metric-trend';

export type { MetricTrend };

export type Metric = {
  label: string;
  /** Valor principal ya formateado (p. ej. "58,16 %"). */
  value: string;
  /** Icono opcional junto a la etiqueta. */
  icon?: LucideIcon;
  trend?: MetricTrend;
  /** `danger` colorea el valor en rojo (p. ej. un conteo de errores > 0). */
  tone?: 'default' | 'danger';
};

/**
 * Grupo de métricas en una sola card, separadas por divisores (vertical en fila,
 * horizontal al apilarse). Reemplaza el patrón de N cards sueltas por KPI. Cada
 * métrica muestra label + valor y un chip de tendencia opcional.
 */
export function MetricsGroup({
  metrics,
  className,
}: {
  metrics: readonly Metric[];
  className?: string;
}) {
  return (
    <Card hover={false} className={className}>
      <div className="flex flex-col divide-y divide-border sm:flex-row sm:divide-x sm:divide-y-0">
        {metrics.map((metric, index) => {
          const Icon = metric.icon;
          return (
            <div
              key={`${metric.label}-${index}`}
              className="flex flex-1 items-start justify-between gap-3 p-5"
            >
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{metric.label}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span
                    className={cn(
                      'text-2xl font-semibold tabular-nums',
                      metric.tone === 'danger' && 'text-destructive',
                    )}
                  >
                    {metric.value}
                  </span>
                  {metric.trend ? <MetricTrendChip trend={metric.trend} /> : null}
                </div>
              </div>
              {Icon ? (
                <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
