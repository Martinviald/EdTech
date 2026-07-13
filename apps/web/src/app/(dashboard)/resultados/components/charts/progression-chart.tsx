'use client';

// ─────────────────────────────────────────────────────────────────────────────
// H6.6 — Gráfico de progresión temporal (FE-B). Línea de % logro a través de las
// evaluaciones del período. Recharts es client-only; recibe los puntos cargados.
// ─────────────────────────────────────────────────────────────────────────────

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PerformanceLevel, ProgressionPoint } from '@soe/types';
import { ChartTooltipCard, type RechartsContentProps } from '@/components/ui/chart-tooltip';
import {
  PERFORMANCE_LEVEL_COLOR,
  PERFORMANCE_LEVEL_LABELS,
} from './performance-distribution';

function formatDate(value: string | Date | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

type ProgressionDatum = {
  label: string;
  instrument: string;
  date: string;
  achievement: number | null;
  level: PerformanceLevel | null;
};

function ProgressionTooltip({ active, payload }: RechartsContentProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as ProgressionDatum | undefined;
  if (!d) return null;
  const levelColor = d.level ? PERFORMANCE_LEVEL_COLOR[d.level] : 'hsl(var(--primary))';
  return (
    <ChartTooltipCard
      title={d.label}
      subtitle={`${d.instrument} · ${d.date}`}
      accentColor={levelColor}
      rows={[
        {
          label: '% de logro',
          value: d.achievement == null ? '—' : `${d.achievement}%`,
          color: 'hsl(var(--primary))',
        },
        ...(d.level
          ? [{ label: 'Nivel', value: PERFORMANCE_LEVEL_LABELS[d.level], color: levelColor }]
          : []),
      ]}
    />
  );
}

export function ProgressionChart({ points }: { points: ProgressionPoint[] }) {
  const data: ProgressionDatum[] = points.map((p) => ({
    label: p.assessmentName ?? p.instrumentName,
    instrument: p.instrumentName,
    date: formatDate(p.administeredAt),
    achievement: p.achievement === null ? null : Math.round(p.achievement * 10) / 10,
    level: p.performanceLevel,
  }));

  return (
    <div className="h-72 w-full sm:h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            content={<ProgressionTooltip />}
            cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
          />
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
