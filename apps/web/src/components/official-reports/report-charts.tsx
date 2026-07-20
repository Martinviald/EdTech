'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Gráficos INTERACTIVOS de los informes oficiales (client). Se separan de
// `report-primitives.tsx` (que sigue siendo server) porque el tooltip moderno
// necesita estado de hover. Todos usan `ChartTooltipCard` para un estilo único.
//   · HBarChart      — barras horizontales (ejes de habilidad).
//   · DonutChart     — torta de distribución por nivel.
//   · StudentDotPlot — dot plot por estudiante con bandas de nivel (Figura 1).
// ─────────────────────────────────────────────────────────────────────────────

import {
  DEFAULT_PERFORMANCE_THRESHOLDS,
  type OfficialCourseStudentRow,
  type PerformanceLevel,
} from '@soe/types';
import { cn } from '@/lib/utils';
import {
  ChartTooltipCard,
  ChartTooltipPortal,
  useChartTooltip,
  type ChartTooltipRow,
} from '@/components/ui/chart-tooltip';
import {
  PERFORMANCE_LEVEL_CHART_COLOR,
  PERFORMANCE_LEVEL_LABELS,
  PERFORMANCE_LEVEL_ORDER,
  performanceLevelLabel,
} from '@/app/(dashboard)/resultados/components/performance-level';
import { fmtPct } from './report-primitives';

// ── Barras horizontales ───────────────────────────────────────────────────────

export type BarDatum = {
  key: string;
  label: string;
  sublabel?: string | null;
  value: number | null; // 0..100
  /** Clase Tailwind de relleno; por defecto primary. */
  barClass?: string;
  /** Color del acento del tooltip (ej. color de nivel). */
  color?: string | null;
  /** Filas extra para el tooltip (nivel, conteos, etc.). */
  tooltip?: ChartTooltipRow[];
};

export function HBarChart({ data }: { data: BarDatum[] }) {
  const { tip, bind } = useChartTooltip<BarDatum>();
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin datos para graficar.</p>;
  }
  return (
    <>
      <ul className="space-y-3">
        {data.map((d) => {
          const pct = d.value ?? 0;
          const width = Math.max(0, Math.min(100, pct));
          return (
            <li
              key={d.key}
              className="-mx-2 space-y-1 rounded-md px-2 py-1 transition-colors hover:bg-muted/50"
              {...bind(d)}
            >
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">
                  {d.label}
                  {d.sublabel ? (
                    <span className="ml-2 text-xs text-muted-foreground">{d.sublabel}</span>
                  ) : null}
                </span>
                <span className="tabular-nums text-muted-foreground">{fmtPct(d.value)}</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full rounded-full', d.barClass ?? 'bg-primary')}
                  style={{ width: `${width}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {tip ? (
        <ChartTooltipPortal x={tip.x} y={tip.y}>
          <ChartTooltipCard
            title={tip.data.label}
            subtitle={tip.data.sublabel ?? undefined}
            accentColor={tip.data.color ?? undefined}
            rows={[{ label: 'Logro', value: fmtPct(tip.data.value) }, ...(tip.data.tooltip ?? [])]}
          />
        </ChartTooltipPortal>
      ) : null}
    </>
  );
}

// ── Torta / distribución por nivel ────────────────────────────────────────────

export type DonutSlice = {
  key: string;
  label: string;
  value: number; // conteo
  color: string; // hex (paleta central de niveles)
  /** % del total (0..100). Si se omite, se calcula sobre el total. */
  percentage?: number;
};

type DonutHover = { slice: DonutSlice; pct: number };

export function DonutChart({ slices, size = 176 }: { slices: DonutSlice[]; size?: number }) {
  const { tip, bind } = useChartTooltip<DonutHover>();
  const total = slices.reduce((acc, s) => acc + s.value, 0);
  const radius = size / 2;
  const cx = radius;
  const cy = radius;

  let cumulative = 0;
  const paths =
    total > 0
      ? slices
          .filter((s) => s.value > 0)
          .map((s) => {
            const startAngle = (cumulative / total) * 2 * Math.PI;
            cumulative += s.value;
            const endAngle = (cumulative / total) * 2 * Math.PI;
            const large = endAngle - startAngle > Math.PI ? 1 : 0;
            const pct = s.percentage ?? (total > 0 ? (s.value / total) * 100 : 0);
            if (s.value >= total) {
              return { key: s.key, color: s.color, circle: true, d: '', slice: s, pct };
            }
            const x1 = cx + radius * Math.sin(startAngle);
            const y1 = cy - radius * Math.cos(startAngle);
            const x2 = cx + radius * Math.sin(endAngle);
            const y2 = cy - radius * Math.cos(endAngle);
            const d = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
            return { key: s.key, color: s.color, circle: false, d, slice: s, pct };
          })
      : [];

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
      {total > 0 ? (
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label="Distribución por nivel de logro"
          className="shrink-0"
        >
          {paths.map((p) =>
            p.circle ? (
              <circle
                key={p.key}
                cx={cx}
                cy={cy}
                r={radius}
                fill={p.color}
                className="cursor-default"
                {...bind({ slice: p.slice, pct: p.pct })}
              />
            ) : (
              <path
                key={p.key}
                d={p.d}
                fill={p.color}
                className="cursor-default transition-opacity hover:opacity-90"
                {...bind({ slice: p.slice, pct: p.pct })}
              />
            ),
          )}
        </svg>
      ) : (
        <div className="flex size-44 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
          Sin datos
        </div>
      )}
      <ul className="w-full space-y-2">
        {slices.map((s) => {
          const pct = s.percentage ?? (total > 0 ? (s.value / total) * 100 : 0);
          return (
            <li
              key={s.key}
              className="-mx-2 flex items-center gap-2 rounded-md px-2 py-0.5 text-sm transition-colors hover:bg-muted/50"
              {...bind({ slice: s, pct })}
            >
              <span
                className="inline-block size-3 shrink-0 rounded-sm"
                style={{ backgroundColor: s.color }}
                aria-hidden
              />
              <span className="flex-1">{s.label}</span>
              <span className="tabular-nums font-medium">{s.value}</span>
              <span className="tabular-nums text-muted-foreground">({pct.toFixed(1)}%)</span>
            </li>
          );
        })}
      </ul>
      {tip ? (
        <ChartTooltipPortal x={tip.x} y={tip.y}>
          <ChartTooltipCard
            title={tip.data.slice.label}
            accentColor={tip.data.slice.color}
            rows={[
              { label: 'Estudiantes', value: tip.data.slice.value },
              { label: 'Del total', value: `${tip.data.pct.toFixed(1)}%` },
            ]}
            footer={total > 0 ? `${total} en total` : undefined}
          />
        </ChartTooltipPortal>
      ) : null}
    </div>
  );
}

// ── Dot plot por estudiante (réplica de la "Figura 1" del informe oficial) ─────

const NAME_COL = 'w-32 shrink-0 sm:w-56';
const ROW_GAP = 'gap-2 sm:gap-3';

const clampPct = (n: number) => Math.max(0, Math.min(100, n));
const roundPct = (n: number) => Math.round(n);

type LevelBand = {
  level: PerformanceLevel;
  label: string;
  color: string;
  min: number;
  max: number;
};

/**
 * Bandas de nivel derivadas de los umbrales COMPARTIDOS
 * (`DEFAULT_PERFORMANCE_THRESHOLDS` de `@soe/types`) — sin literales hardcodeados.
 * Espejan la clasificación que usa el informe (`percentageToPerformanceLevel`).
 */
const LEVEL_BANDS: LevelBand[] = (() => {
  const t = DEFAULT_PERFORMANCE_THRESHOLDS;
  const edges: Record<PerformanceLevel, [number, number]> = {
    insufficient: [0, t.elementary * 100],
    elementary: [t.elementary * 100, t.adequate * 100],
    adequate: [t.adequate * 100, t.advanced * 100],
    advanced: [t.advanced * 100, 100],
  };
  return PERFORMANCE_LEVEL_ORDER.map((level) => ({
    level,
    label: PERFORMANCE_LEVEL_LABELS[level],
    color: PERFORMANCE_LEVEL_CHART_COLOR[level],
    min: edges[level][0],
    max: edges[level][1],
  }));
})();

type DotHover =
  | { kind: 'student'; row: OfficialCourseStudentRow; index: number }
  | { kind: 'band'; band: LevelBand; count: number };

/**
 * Réplica de la Figura 1: una fila por estudiante con su % de logro como punto
 * sobre las bandas de nivel del instrumento. Tooltip por punto (detalle del
 * estudiante) y por banda (nivel + conteo).
 */
export function StudentDotPlot({ students }: { students: OfficialCourseStudentRow[] }) {
  const { tip, bind } = useChartTooltip<DotHover>();
  const withData = students.filter((s) => s.achievement !== null);
  if (withData.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin resultados por estudiante.</p>;
  }

  const countByLevel = new Map<PerformanceLevel, number>();
  for (const s of withData) {
    if (s.performanceLevel) {
      countByLevel.set(s.performanceLevel, (countByLevel.get(s.performanceLevel) ?? 0) + 1);
    }
  }

  return (
    <figure className="space-y-3 rounded-md border bg-card p-3 sm:p-4">
      {/* Encabezado: etiqueta de cada nivel centrada sobre su banda. */}
      <div className={cn('flex items-end', ROW_GAP)}>
        <div className={NAME_COL} aria-hidden />
        <div className="relative h-4 flex-1">
          {LEVEL_BANDS.map((b) => (
            <div
              key={b.level}
              className="absolute inset-y-0 flex items-end justify-center overflow-hidden px-0.5"
              style={{ left: `${b.min}%`, width: `${b.max - b.min}%` }}
              {...bind({ kind: 'band', band: b, count: countByLevel.get(b.level) ?? 0 })}
            >
              <span
                className="truncate text-[10px] font-semibold uppercase tracking-wide sm:text-xs"
                style={{ color: b.color }}
              >
                {b.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Filas contiguas → bandas de nivel continuas. */}
      <div role="img" aria-label="Nivel de logro por estudiante">
        {withData.map((s, i) => {
          const x = clampPct(s.achievement ?? 0);
          const idx = String(i + 1).padStart(2, '0');
          const dotColor = s.performanceLevel
            ? PERFORMANCE_LEVEL_CHART_COLOR[s.performanceLevel]
            : '#94a3b8';
          return (
            <div key={s.studentId} className={cn('flex items-center break-inside-avoid', ROW_GAP)}>
              <div
                className={cn(NAME_COL, 'truncate text-right text-xs text-foreground')}
                title={s.studentFullName}
              >
                <span className="tabular-nums text-muted-foreground">{idx}</span>{' '}
                {s.studentFullName}
              </div>
              <div className="relative h-6 flex-1">
                {LEVEL_BANDS.map((b) => (
                  <div
                    key={b.level}
                    className="absolute inset-y-0"
                    style={{
                      left: `${b.min}%`,
                      width: `${b.max - b.min}%`,
                      backgroundColor: `${b.color}22`,
                    }}
                    aria-hidden
                  />
                ))}
                {LEVEL_BANDS.slice(1).map((b) => (
                  <div
                    key={`div-${b.level}`}
                    className="absolute inset-y-0 w-px bg-border"
                    style={{ left: `${b.min}%` }}
                    aria-hidden
                  />
                ))}
                <div
                  className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-dashed border-border/70"
                  aria-hidden
                />
                {/* Punto = % de logro, coloreado por su nivel. Área de hover ampliada. */}
                <span
                  className="absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                  style={{ left: `${x}%` }}
                  {...bind({ kind: 'student', row: s, index: i })}
                >
                  <span
                    className="size-2.5 rounded-full ring-2 ring-card transition-transform hover:scale-125"
                    style={{ backgroundColor: dotColor }}
                  />
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pie: eje con los cortes de nivel marcados. */}
      <div className={cn('flex items-center', ROW_GAP)}>
        <div className={NAME_COL} aria-hidden />
        <div className="relative h-4 flex-1 text-xs text-muted-foreground">
          <span className="absolute left-0 tabular-nums">0%</span>
          {LEVEL_BANDS.slice(1).map((b) => (
            <span
              key={`tick-${b.level}`}
              className="absolute hidden -translate-x-1/2 tabular-nums sm:inline"
              style={{ left: `${b.min}%` }}
            >
              {roundPct(b.min)}%
            </span>
          ))}
          <span className="absolute right-0 tabular-nums">100%</span>
        </div>
      </div>

      {/* Leyenda: nivel + rango de % + n° de estudiantes. */}
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {LEVEL_BANDS.map((b) => (
          <span key={b.level} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: b.color }}
              aria-hidden
            />
            <span className="text-foreground">{b.label}</span>
            <span className="tabular-nums">
              {roundPct(b.min)}–{roundPct(b.max)}% · {countByLevel.get(b.level) ?? 0}
            </span>
          </span>
        ))}
      </figcaption>

      {tip ? (
        <ChartTooltipPortal x={tip.x} y={tip.y}>
          {tip.data.kind === 'student' ? (
            <StudentDotTooltip row={tip.data.row} index={tip.data.index} />
          ) : (
            <ChartTooltipCard
              title={tip.data.band.label}
              accentColor={tip.data.band.color}
              rows={[
                {
                  label: 'Rango de logro',
                  value: `${roundPct(tip.data.band.min)}–${roundPct(tip.data.band.max)}%`,
                },
                { label: 'Estudiantes', value: tip.data.count },
              ]}
            />
          )}
        </ChartTooltipPortal>
      ) : null}
    </figure>
  );
}

/** Color de la banda que contiene `pct` (para colorear el punto sin `performanceLevel`). */
function bandColorForPct(pct: number): string {
  const band = LEVEL_BANDS.find((b) => pct >= b.min && pct < b.max) ?? LEVEL_BANDS.at(-1);
  return band?.color ?? '#94a3b8';
}

/**
 * Franja de nivel de logro de UN estudiante: la misma "línea horizontal" del
 * dot-plot del informe de monitoreo (bandas de nivel + divisiones), con el punto
 * ubicado en su % de logro. Quienes requieren mayor apoyo caen a la izquierda.
 * Presentacional: sin tooltip interactivo (se usa dentro de las filas de tabla).
 */
export function StudentBandStrip({
  achievement,
  performanceLevel,
  requiresSupport,
}: {
  achievement: number | null;
  performanceLevel: PerformanceLevel | null;
  requiresSupport: boolean;
}) {
  const x = achievement === null ? null : clampPct(achievement);
  const dotColor = performanceLevel
    ? PERFORMANCE_LEVEL_CHART_COLOR[performanceLevel]
    : x !== null
      ? bandColorForPct(x)
      : '#94a3b8';
  return (
    <div className="relative h-6 w-full min-w-[160px]" role="img" aria-label="Nivel de logro">
      {LEVEL_BANDS.map((b) => (
        <div
          key={b.level}
          className="absolute inset-y-0"
          style={{
            left: `${b.min}%`,
            width: `${b.max - b.min}%`,
            backgroundColor: `${b.color}22`,
          }}
          aria-hidden
        />
      ))}
      {LEVEL_BANDS.slice(1).map((b) => (
        <div
          key={`div-${b.level}`}
          className="absolute inset-y-0 w-px bg-border"
          style={{ left: `${b.min}%` }}
          aria-hidden
        />
      ))}
      <div
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-dashed border-border/70"
        aria-hidden
      />
      {x !== null ? (
        <span
          className="absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          style={{ left: `${x}%` }}
          title={`${fmtPct(achievement)}${requiresSupport ? ' · Requiere mayor apoyo' : ''}`}
        >
          <span
            className="size-2.5 rounded-full ring-2 ring-card"
            style={{ backgroundColor: dotColor }}
          />
        </span>
      ) : (
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          —
        </span>
      )}
    </div>
  );
}

function StudentDotTooltip({ row, index }: { row: OfficialCourseStudentRow; index: number }) {
  const color = row.performanceLevel
    ? PERFORMANCE_LEVEL_CHART_COLOR[row.performanceLevel]
    : undefined;
  const rows: ChartTooltipRow[] = [
    { label: '% de logro', value: fmtPct(row.achievement) },
    {
      label: 'Nivel',
      value: performanceLevelLabel(row.performanceLevel),
      color: color ?? null,
    },
  ];
  if (row.grade !== null) rows.push({ label: 'Nota', value: row.grade.toFixed(1) });
  return (
    <ChartTooltipCard
      title={`${String(index + 1).padStart(2, '0')} ${row.studentFullName}`}
      subtitle={row.studentRut}
      accentColor={color}
      rows={rows}
      footer={row.requiresSupport ? 'Requiere mayor apoyo' : undefined}
    />
  );
}
