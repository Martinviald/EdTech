import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Primitivas de presentación compartidas por los tres informes oficiales
// (TKT-24/25/26). Todas son Server Components (sin estado): portada, secciones,
// recuadros de advertencia/definiciones, y gráficos simples (barras y torta) con
// SVG/divs + tokens Tailwind (sin hex inline salvo la paleta central de niveles).
// ─────────────────────────────────────────────────────────────────────────────

/** Formatea un % 0..100 (o null) con un decimal. */
export function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

/** Formatea una fecha ISO/Date a formato largo es-CL. */
export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Formatea fecha + hora (para "generado el"). */
export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CL', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Contenedor raíz del informe. Marca `.print-root`, que el print stylesheet
 * global aísla al imprimir (oculta el resto de la app). En pantalla se ve como un
 * "papel": fondo de tarjeta, borde y ancho de lectura.
 */
export function ReportShell({ children }: { children: ReactNode }) {
  return (
    <div className="print-root mx-auto max-w-4xl space-y-8 rounded-lg border bg-card p-6 text-card-foreground shadow-sm sm:p-10">
      {children}
    </div>
  );
}

/** Portada: título, subtítulo (momento/instrumento) y una grilla de metadatos. */
export function ReportCover({
  eyebrow,
  title,
  subtitle,
  meta,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string | null;
  meta: { label: string; value: string }[];
}) {
  return (
    <header className="space-y-5 border-b pb-6">
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {eyebrow}
        </p>
      ) : null}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle ? <p className="text-base text-muted-foreground">{subtitle}</p> : null}
      </div>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        {meta.map((m) => (
          <div key={m.label} className="flex flex-col">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {m.label}
            </dt>
            <dd className="text-sm font-medium">{m.value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

/** Sección numerada del informe con título. */
export function ReportSection({
  index,
  title,
  description,
  children,
}: {
  index?: number;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">
          {index !== undefined ? (
            <span className="mr-2 text-muted-foreground">{index}.</span>
          ) : null}
          {title}
        </h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Recuadro de advertencia de uso (portada). */
export function DisclaimerBox({ disclaimers }: { disclaimers: string[] }) {
  if (disclaimers.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
      <div className="mb-1 flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        Usos que este informe NO permite
      </div>
      <ul className="ml-1 space-y-1">
        {disclaimers.map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
    </div>
  );
}

/** Recuadro informativo neutro (definiciones de nivel, notas de alcance). */
export function InfoBox({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-md border bg-muted/40 p-4 text-sm">
      <p className="mb-2 font-semibold">{title}</p>
      <ul className="space-y-1 text-muted-foreground">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

/** Recuadro de "Preguntas guía" para completar (reflexión pedagógica). */
export function GuideQuestionsBox({ prompts }: { prompts: string[] }) {
  if (prompts.length === 0) return null;
  return (
    <div className="rounded-md border border-dashed p-4">
      <p className="mb-2 text-sm font-semibold">Preguntas guía</p>
      <ol className="ml-4 list-decimal space-y-3 text-sm text-muted-foreground">
        {prompts.map((p, i) => (
          <li key={i} className="space-y-2">
            <span>{p}</span>
            <span className="block h-8 rounded border-b border-dashed" aria-hidden />
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Gráfico de barras horizontales (ejes de habilidad, etc.) ──────────────────

export type BarDatum = {
  key: string;
  label: string;
  sublabel?: string | null;
  value: number | null; // 0..100
  /** Clase Tailwind de relleno; por defecto primary. */
  barClass?: string;
};

export function HBarChart({ data }: { data: BarDatum[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin datos para graficar.</p>;
  }
  return (
    <ul className="space-y-3">
      {data.map((d) => {
        const pct = d.value ?? 0;
        const width = Math.max(0, Math.min(100, pct));
        return (
          <li key={d.key} className="space-y-1">
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
  );
}

// ── Gráfico de torta (distribución por nivel) ─────────────────────────────────

export type DonutSlice = {
  key: string;
  label: string;
  value: number; // conteo o %
  color: string; // hex (paleta central de niveles)
};

/**
 * Torta SVG a partir de segmentos con color hex. Los colores provienen de la
 * paleta central de niveles (`PERFORMANCE_LEVEL_CHART_COLOR`), no de hex inline
 * arbitrarios. Incluye leyenda con % calculado sobre el total.
 */
export function DonutChart({ slices, size = 176 }: { slices: DonutSlice[]; size?: number }) {
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
            // Segmento único que cubre todo el círculo → dibuja un círculo completo.
            if (s.value >= total) {
              return { key: s.key, color: s.color, circle: true, d: '' };
            }
            const x1 = cx + radius * Math.sin(startAngle);
            const y1 = cy - radius * Math.cos(startAngle);
            const x2 = cx + radius * Math.sin(endAngle);
            const y2 = cy - radius * Math.cos(endAngle);
            const d = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
            return { key: s.key, color: s.color, circle: false, d };
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
              <circle key={p.key} cx={cx} cy={cy} r={radius} fill={p.color} />
            ) : (
              <path key={p.key} d={p.d} fill={p.color} />
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
          const pct = total > 0 ? (s.value / total) * 100 : 0;
          return (
            <li key={s.key} className="flex items-center gap-2 text-sm">
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
    </div>
  );
}
