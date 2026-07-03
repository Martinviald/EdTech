import type { JSX } from 'react';
import type { AiCostTimeseriesResponse } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUsd, formatInt } from './format';

// ─────────────────────────────────────────────────────────────────────────────
// H19.25 — Serie temporal de costo diario como BARRAS SIMPLES (divs Tailwind, sin
// librería de charts). Cada barra es un día; la altura es proporcional al máximo
// gasto del rango. El backend omite días sin gasto; aquí sólo se grafican los que
// vienen (lista de puntos ya ordenada por fecha).
// ─────────────────────────────────────────────────────────────────────────────

export function CostTimeseries({
  timeseries,
}: {
  timeseries: AiCostTimeseriesResponse;
}): JSX.Element {
  const { points } = timeseries;
  const maxCost = points.reduce((max, p) => Math.max(max, p.costUsd), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Gasto diario</CardTitle>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay gasto de IA registrado en el rango.
          </p>
        ) : (
          <div className="w-full overflow-x-auto">
            <div className="flex min-w-full items-end gap-1" style={{ height: 180 }}>
              {points.map((point) => {
                const heightPct = maxCost > 0 ? Math.max((point.costUsd / maxCost) * 100, 2) : 2;
                return (
                  <div
                    key={point.date}
                    className="group flex min-w-[14px] flex-1 flex-col items-center justify-end gap-1"
                  >
                    <span className="invisible whitespace-nowrap text-[10px] tabular-nums text-muted-foreground group-hover:visible">
                      {formatUsd(point.costUsd)}
                    </span>
                    <div
                      className="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary"
                      style={{ height: `${heightPct}%` }}
                      title={`${point.date}: ${formatUsd(point.costUsd)} · ${formatInt(point.count)} op.`}
                      aria-label={`${point.date}: ${formatUsd(point.costUsd)}`}
                    />
                    <span className="rotate-0 text-[9px] tabular-nums text-muted-foreground">
                      {point.date.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
