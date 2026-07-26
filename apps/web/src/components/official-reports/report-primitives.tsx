import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

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
    <div className="rounded-md border border-warning/40 bg-warning/10 p-4 text-sm text-warning-foreground">
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

// Los gráficos interactivos (HBarChart, DonutChart) viven en `report-charts.tsx`
// ('use client') porque su tooltip moderno requiere estado de hover.
