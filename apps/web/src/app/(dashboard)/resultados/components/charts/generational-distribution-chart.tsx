'use client';

// ─────────────────────────────────────────────────────────────────────────────
// H6.3 — Distribución de desempeño por año (FE-B). Barra apilada al 100% que
// muestra la proporción de cada nivel de desempeño en cada generación.
// ─────────────────────────────────────────────────────────────────────────────

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { GenerationalPoint, PerformanceLevel } from '@soe/types';
import {
  PERFORMANCE_LEVEL_COLOR,
  PERFORMANCE_LEVEL_LABELS,
  PERFORMANCE_LEVEL_ORDER,
} from './performance-distribution';

type Row = { year: string } & Record<PerformanceLevel, number>;

export function GenerationalDistributionChart({ series }: { series: GenerationalPoint[] }) {
  const data: Row[] = series.map((p) => {
    const base = { year: String(p.year) } as Row;
    for (const level of PERFORMANCE_LEVEL_ORDER) base[level] = 0;
    for (const bucket of p.performanceDistribution) {
      base[bucket.level] = Math.round(bucket.percentage * 10) / 10;
    }
    return base;
  });

  return (
    <div className="h-72 w-full sm:h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            formatter={(value, name) => [
              `${value}%`,
              PERFORMANCE_LEVEL_LABELS[name as PerformanceLevel] ?? String(name),
            ]}
            labelFormatter={(label) => `Año ${String(label)}`}
          />
          <Legend
            formatter={(value: string) =>
              PERFORMANCE_LEVEL_LABELS[value as PerformanceLevel] ?? value
            }
          />
          {PERFORMANCE_LEVEL_ORDER.map((level) => (
            <Bar
              key={level}
              dataKey={level}
              name={level}
              stackId="dist"
              fill={PERFORMANCE_LEVEL_COLOR[level]}
              maxBarSize={64}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
