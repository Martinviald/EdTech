import type { LucideIcon } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { MetricTrendChip, type MetricTrend } from './metric-trend';

/**
 * Card de una métrica: label + valor grande + hint/icono/tendencia opcionales.
 * Reemplaza las implementaciones sueltas de "una métrica = una card"
 * (`SummaryCard` y afines). Para varias métricas juntas, usar `MetricsGroup`.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  trend,
}: {
  label: string;
  /** Valor principal ya formateado (p. ej. "72,4 %"). */
  value: string;
  hint?: string;
  icon?: LucideIcon;
  trend?: MetricTrend;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
            {trend ? <MetricTrendChip trend={trend} /> : null}
          </div>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {Icon ? (
          <div className="rounded-lg bg-muted p-2">
            <Icon className="size-5 text-muted-foreground" aria-hidden />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
