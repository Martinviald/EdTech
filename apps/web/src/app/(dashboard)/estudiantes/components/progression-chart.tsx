'use client';

import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export type ProgressionPoint = { label: string; achievement: number | null };

export type ProgressionLine = {
  key: string;
  label: string;
  color?: string;
  points: ProgressionPoint[];
};

const DEFAULT_LINE_COLOR = 'hsl(var(--chart-series-1))';

const ProgressionChartImpl = dynamic(
  () => import('./progression-chart.impl').then((m) => m.ProgressionChartImpl),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full" />,
  },
);

function ProgressionLegend({ lines }: { lines: ProgressionLine[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-2">
      {lines.map((line) => (
        <li key={line.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className="h-0.5 w-4 shrink-0 rounded-full"
            style={{ backgroundColor: line.color ?? DEFAULT_LINE_COLOR }}
            aria-hidden
          />
          <span>{line.label}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Trayectoria del % de logro (0..100) del alumno. Una o varias líneas: por
 * asignatura es una línea por serie comparable; por nodo (eje/OA) es la serie
 * cronológica del propio nodo. `compact` oculta ejes/dots para leerse como
 * sparkline en una celda de tabla.
 */
export function ProgressionChart({
  lines,
  height = 224,
  compact = false,
  className,
}: {
  lines: ProgressionLine[];
  height?: number;
  compact?: boolean;
  className?: string;
}) {
  if (lines.length === 0) return null;
  const showLegend = !compact && lines.length > 1;

  return (
    <div className={cn('w-full', className)}>
      <div style={{ height }}>
        <ProgressionChartImpl lines={lines} compact={compact} />
      </div>
      {showLegend ? <ProgressionLegend lines={lines} /> : null}
    </div>
  );
}
