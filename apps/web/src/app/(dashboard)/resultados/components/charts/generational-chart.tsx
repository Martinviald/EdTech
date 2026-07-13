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
import { ChartTooltipCard, type RechartsContentProps } from '@/components/ui/chart-tooltip';

type GenerationalDatum = {
  year: string;
  averageAchievement: number | null;
  passingRate: number | null;
  studentsCount: number;
};

function GenerationalTooltip({ active, payload }: RechartsContentProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as GenerationalDatum | undefined;
  if (!d) return null;
  return (
    <ChartTooltipCard
      title={`Año ${d.year}`}
      rows={[
        {
          label: '% logro promedio',
          value: d.averageAchievement == null ? '—' : `${d.averageAchievement}%`,
          color: 'hsl(var(--primary))',
        },
        {
          label: '% aprobación',
          value: d.passingRate == null ? '—' : `${d.passingRate}%`,
          color: 'hsl(var(--accent))',
        },
      ]}
      footer={`${d.studentsCount} ${d.studentsCount === 1 ? 'estudiante' : 'estudiantes'}`}
    />
  );
}

export function GenerationalChart({ series }: { series: GenerationalPoint[] }) {
  const data: GenerationalDatum[] = series.map((p) => ({
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
            content={<GenerationalTooltip />}
            cursor={{ fill: 'hsl(var(--muted) / 0.5)' }}
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
