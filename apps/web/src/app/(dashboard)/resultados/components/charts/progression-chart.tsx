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
import type { ProgressionPoint } from '@soe/types';

function formatDate(value: string | Date | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ProgressionChart({ points }: { points: ProgressionPoint[] }) {
  const data = points.map((p) => ({
    label: p.assessmentName ?? p.instrumentName,
    date: formatDate(p.administeredAt),
    achievement: p.achievement === null ? null : Math.round(p.achievement * 10) / 10,
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
            formatter={(value) => [value == null ? '—' : `${value}%`, '% logro']}
            labelFormatter={(_label, payload) => {
              const item = payload?.[0]?.payload as { label: string; date: string } | undefined;
              return item ? `${item.label} · ${item.date}` : '';
            }}
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
