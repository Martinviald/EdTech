'use client';

import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartTooltipCard, type RechartsContentProps } from '@/components/ui/chart-tooltip';
import { formatAchievement } from '../../resultados/components/performance-level';
import type { ProgressionLine } from './progression-chart';

const DEFAULT_LINE_COLOR = 'hsl(var(--chart-series-1))';

type ProgressionDatum = { label: string } & Record<string, string | number | null>;

function buildData(lines: ProgressionLine[]): ProgressionDatum[] {
  const rows = new Map<string, ProgressionDatum>();
  const order: string[] = [];
  for (const line of lines) {
    for (const point of line.points) {
      let row = rows.get(point.label);
      if (!row) {
        row = { label: point.label };
        rows.set(point.label, row);
        order.push(point.label);
      }
      row[line.key] = point.achievement;
    }
  }
  return order.map((label) => rows.get(label)!);
}

function ProgressionTooltip({
  active,
  payload,
  lines,
  showLineLabels,
}: RechartsContentProps & { lines: ProgressionLine[]; showLineLabels: boolean }) {
  if (!active || !payload?.length) return null;
  const datum = payload[0]?.payload as ProgressionDatum | undefined;
  if (!datum) return null;

  const rows = lines
    .map((line) => {
      const achievement = datum[line.key];
      if (achievement === undefined) return null;
      return {
        label: showLineLabels ? line.label : 'Logro',
        value: formatAchievement(typeof achievement === 'number' ? achievement : null),
        color: line.color ?? DEFAULT_LINE_COLOR,
        muted: typeof achievement !== 'number',
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return <ChartTooltipCard title={datum.label} rows={rows} />;
}

export function ProgressionChartImpl({
  lines,
  compact = false,
}: {
  lines: ProgressionLine[];
  compact?: boolean;
}) {
  const data = useMemo(() => buildData(lines), [lines]);
  const showLineLabels = lines.length > 1;

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: compact ? -20 : 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            className="fill-muted-foreground"
            interval={0}
            minTickGap={8}
            hide={compact}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11 }}
            className="fill-muted-foreground"
            tickFormatter={(v: number) => `${v}%`}
            width={compact ? 32 : 44}
            hide={compact}
          />
          <Tooltip
            content={<ProgressionTooltip lines={lines} showLineLabels={showLineLabels} />}
            cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
          />
          {lines.map((line, index) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.label}
              stroke={line.color ?? DEFAULT_LINE_COLOR}
              strokeWidth={index === 0 ? 2.5 : 2}
              dot={
                compact ? false : { r: 3, strokeWidth: 0, fill: line.color ?? DEFAULT_LINE_COLOR }
              }
              activeDot={{ r: 5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
