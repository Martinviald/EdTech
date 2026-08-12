'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Gráfico de la trayectoria comparable: una línea de % de logro a través de los
// puntos de la serie. A diferencia de la progresión antigua, todos los puntos
// pertenecen a la MISMA familia comparable (mismo tipo + asignatura + nivel), así
// que unirlos con una línea es legítimo: mide movimiento, no mezcla instrumentos.
// ─────────────────────────────────────────────────────────────────────────────

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  INSTRUMENT_APPLICATION_PERIOD_SHORT_LABELS,
  type ComparableTrajectoryAxis,
  type ComparableTrajectoryPoint,
} from '@soe/types';
import { ChartTooltipCard, type RechartsContentProps } from '@/components/ui/chart-tooltip';

type TrajectoryDatum = {
  /** Etiqueta del eje X: corta, porque la serie puede traer años × momentos. */
  tick: string;
  label: string;
  instrument: string;
  achievement: number | null;
  students: number;
};

/**
 * En el eje de generaciones el punto ES el año, así que la etiqueta completa ya es corta.
 * En la trayectoria cada punto es una aplicación (año + momento) y "Diagnóstico 2024" no
 * cabe repetido: se abrevia a "2024 Diag." y el nombre completo queda en el tooltip.
 */
function tickOf(point: ComparableTrajectoryPoint, axis: ComparableTrajectoryAxis): string {
  if (axis === 'years' || point.year == null || point.applicationPeriod == null) return point.label;
  return `${point.year} ${INSTRUMENT_APPLICATION_PERIOD_SHORT_LABELS[point.applicationPeriod]}`;
}

function TrajectoryTooltip({ active, payload }: RechartsContentProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as TrajectoryDatum | undefined;
  if (!d) return null;
  return (
    <ChartTooltipCard
      title={d.label}
      subtitle={d.instrument}
      accentColor="hsl(var(--primary))"
      rows={[
        {
          label: '% de logro',
          value: d.achievement == null ? '—' : `${d.achievement}%`,
          color: 'hsl(var(--primary))',
        },
        { label: 'Alumnos', value: d.students },
      ]}
    />
  );
}

export function TrajectoryChart({
  series,
  axis,
  baselineAchievement,
  baselineLabel,
}: {
  series: ComparableTrajectoryPoint[];
  axis: ComparableTrajectoryAxis;
  baselineAchievement?: number | null;
  baselineLabel?: string;
}) {
  const data: TrajectoryDatum[] = series.map((p) => ({
    tick: tickOf(p, axis),
    label: p.label,
    instrument: p.instrumentName,
    achievement: p.averageAchievement === null ? null : Math.round(p.averageAchievement * 10) / 10,
    students: p.studentsAssessed,
  }));

  return (
    <div className="h-72 w-full sm:h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="tick"
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
            interval="preserveStartEnd"
            minTickGap={8}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            content={<TrajectoryTooltip />}
            cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
          />
          {baselineAchievement != null ? (
            <ReferenceLine
              y={baselineAchievement}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="4 4"
              label={{
                value: baselineLabel ?? 'referencia',
                position: 'insideTopRight',
                fontSize: 11,
                fill: 'hsl(var(--muted-foreground))',
              }}
            />
          ) : null}
          <Line
            type="monotone"
            dataKey="achievement"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
