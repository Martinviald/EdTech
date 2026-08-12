'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Trayectoria del % de logro: el eje X es el ciclo (Diagnóstico → Monitoreo →
// Cierre) y hay UNA línea por año. Todas las líneas son la misma familia
// comparable (mismo tipo + asignatura + nivel), así que el año en curso se lee
// evaluación a evaluación contra los años anteriores del mismo nivel: mismo
// instrumento, mismo corte de niveles, eje comparable.
//
// Los alumnos de una línea anterior son OTRA generación (hoy están un nivel más
// arriba). Eso se dice en la etiqueta de la serie, nunca cambiando la escala.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ComparableTrajectoryYearSeries } from '@soe/types';
import { ChartTooltipCard, type RechartsContentProps } from '@/components/ui/chart-tooltip';
import { cn } from '@/lib/utils';
import { trajectoryYearChartColor } from '../performance-level';

type PeriodAxis = { key: string; label: string };

type YearLine = {
  /** `dataKey` de la línea. Estable por año, para que el color no dependa del filtro. */
  dataKey: string;
  label: string;
  color: string;
};

/** Una fila del gráfico: un momento del ciclo con el valor de cada año en ese momento. */
type PeriodDatum = {
  period: string;
  label: string;
} & Record<string, string | number | null>;

const ACHIEVEMENT_PREFIX = 'y:';
const STUDENTS_PREFIX = 'n:';

function achievementKey(series: ComparableTrajectoryYearSeries, index: number): string {
  return `${ACHIEVEMENT_PREFIX}${series.year ?? `s${index}`}`;
}

function roundAchievement(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

function buildLines(series: ComparableTrajectoryYearSeries[]): YearLine[] {
  return series.map((s, index) => ({
    dataKey: achievementKey(s, index),
    label: s.label,
    color: trajectoryYearChartColor(index),
  }));
}

function buildData(series: ComparableTrajectoryYearSeries[], periods: PeriodAxis[]): PeriodDatum[] {
  const rows = new Map<string, PeriodDatum>();
  for (const period of periods) {
    rows.set(period.key, { period: period.key, label: period.label });
  }
  series.forEach((s, index) => {
    const key = achievementKey(s, index);
    for (const point of s.points) {
      const row = rows.get(point.key);
      if (!row) continue;
      row[key] = roundAchievement(point.averageAchievement);
      row[`${STUDENTS_PREFIX}${key}`] = point.studentsAssessed;
    }
  });
  return Array.from(rows.values());
}

function PeriodTooltip({
  active,
  payload,
  lines,
  hidden,
}: RechartsContentProps & { lines: YearLine[]; hidden: ReadonlySet<string> }) {
  if (!active || !payload?.length) return null;
  const datum = payload[0]?.payload as PeriodDatum | undefined;
  if (!datum) return null;

  const rows = lines
    .filter((line) => !hidden.has(line.dataKey))
    .map((line) => {
      const achievement = datum[line.dataKey];
      const students = datum[`${STUDENTS_PREFIX}${line.dataKey}`];
      return {
        label: line.label,
        value:
          typeof achievement === 'number'
            ? `${achievement}% · ${typeof students === 'number' ? students : 0} alumnos`
            : 'Sin datos',
        color: line.color,
        muted: typeof achievement !== 'number',
      };
    });

  return <ChartTooltipCard title={datum.label} rows={rows} />;
}

function YearLegend({
  lines,
  hidden,
  onToggle,
}: {
  lines: YearLine[];
  hidden: ReadonlySet<string>;
  onToggle: (dataKey: string) => void;
}) {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-3">
      {lines.map((line) => {
        const off = hidden.has(line.dataKey);
        return (
          <li key={line.dataKey}>
            <button
              type="button"
              aria-pressed={!off}
              onClick={() => onToggle(line.dataKey)}
              className={cn(
                'flex items-center gap-1.5 rounded px-1 py-0.5 text-xs transition-colors',
                off ? 'text-muted-foreground/60' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span
                className="h-0.5 w-4 shrink-0 rounded-full"
                style={{ backgroundColor: off ? 'currentColor' : line.color }}
                aria-hidden
              />
              <span className={cn(off && 'line-through')}>{line.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function TrajectoryChart({
  series,
  periods,
}: {
  series: ComparableTrajectoryYearSeries[];
  periods: { key: string; label: string }[];
}) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set<string>());

  const lines = useMemo(() => buildLines(series), [series]);
  const data = useMemo(() => buildData(series, periods), [series, periods]);

  const toggle = (dataKey: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(dataKey)) next.delete(dataKey);
      else next.add(dataKey);
      return next;
    });
  };

  return (
    <div className="h-80 w-full sm:h-96">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
            interval={0}
            minTickGap={8}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            content={<PeriodTooltip lines={lines} hidden={hidden} />}
            cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
          />
          <Legend
            verticalAlign="bottom"
            content={() => <YearLegend lines={lines} hidden={hidden} onToggle={toggle} />}
          />
          {lines.map((line, index) => (
            <Line
              key={line.dataKey}
              type="monotone"
              dataKey={line.dataKey}
              name={line.label}
              stroke={line.color}
              strokeWidth={index === 0 ? 2.5 : 2}
              dot={{ r: 4, strokeWidth: 0, fill: line.color }}
              activeDot={{ r: 6 }}
              connectNulls={false}
              hide={hidden.has(line.dataKey)}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
