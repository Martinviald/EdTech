'use client';

// ─────────────────────────────────────────────────────────────────────────────
// H6.3 — Gráfico de comparación de generaciones (FE-B). Recharts es client-only.
// Recibe la serie ya cargada en el Server Component (no hace fetch).
// ─────────────────────────────────────────────────────────────────────────────

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { GenerationalPoint } from '@soe/types';

export function GenerationalChart({ series }: { series: GenerationalPoint[] }) {
  const data = series.map((p) => ({
    year: String(p.year),
    averageAchievement:
      p.averageAchievement === null ? null : Math.round(p.averageAchievement * 10) / 10,
    passingRate: p.passingRate === null ? null : Math.round(p.passingRate * 10) / 10,
    studentsCount: p.studentsCount,
  }));

  return (
    <div className="h-72 w-full sm:h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            formatter={(value, name) => {
              const label =
                name === 'averageAchievement'
                  ? '% logro promedio'
                  : name === 'passingRate'
                    ? '% aprobación'
                    : String(name);
              return [value == null ? '—' : `${value}%`, label];
            }}
            labelFormatter={(label) => `Año ${String(label)}`}
          />
          <Legend
            formatter={(value: string) =>
              value === 'averageAchievement'
                ? '% logro promedio'
                : value === 'passingRate'
                  ? '% aprobación'
                  : value
            }
          />
          <Bar
            dataKey="averageAchievement"
            name="averageAchievement"
            fill="hsl(var(--primary))"
            radius={[4, 4, 0, 0]}
            maxBarSize={64}
          />
          <Line
            type="monotone"
            dataKey="passingRate"
            name="passingRate"
            stroke="hsl(var(--accent))"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
