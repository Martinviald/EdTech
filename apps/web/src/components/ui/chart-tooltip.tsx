'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip compartido para TODOS los gráficos de la app (dot plot, barras, torta,
// heatmaps y charts de recharts). Un único lenguaje visual: tarjeta redondeada,
// borde, sombra, backdrop y filas etiqueta/valor con swatch de color.
//
// Dos formas de uso:
//  1) Charts custom (SVG/divs): `useChartTooltip()` maneja el estado de hover y
//     `ChartTooltipPortal` posiciona la tarjeta siguiendo el cursor (via portal a
//     body → nunca se recorta por overflow del contenedor).
//  2) recharts: pasar `content={<RechartsChartTooltip .../>}` al `<Tooltip>`.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export type ChartTooltipRow = {
  label: ReactNode;
  value: ReactNode;
  /** Color del swatch (hex o color CSS). Omitir para no mostrar swatch. */
  color?: string | null;
  /** Fila secundaria (texto atenuado). */
  muted?: boolean;
};

export type ChartTooltipCardProps = {
  title?: ReactNode;
  /** Línea de contexto bajo el título (curso, eje, etc.). */
  subtitle?: ReactNode;
  rows?: ChartTooltipRow[];
  /** Punto de color junto al título (nivel, serie…). */
  accentColor?: string | null;
  /** Nota al pie (ej. "n = 41"). */
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
};

/**
 * Tarjeta visual del tooltip. Presentacional y reutilizable: la usan tanto los
 * charts custom (via portal) como recharts (via `content`).
 */
export function ChartTooltipCard({
  title,
  subtitle,
  rows,
  accentColor,
  footer,
  className,
  children,
}: ChartTooltipCardProps) {
  return (
    <div
      className={cn(
        'pointer-events-none min-w-[8.5rem] max-w-[18rem] rounded-lg border bg-popover/95 px-3 py-2 text-popover-foreground shadow-xl ring-1 ring-black/5 backdrop-blur-sm',
        className,
      )}
      role="tooltip"
    >
      {title != null ? (
        <div
          className={cn(
            'flex items-center gap-2 text-xs font-semibold leading-tight',
            (rows?.length || children || footer) && 'mb-1.5 border-b pb-1.5',
          )}
        >
          {accentColor ? (
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: accentColor }}
              aria-hidden
            />
          ) : null}
          <span className="min-w-0 break-words">{title}</span>
        </div>
      ) : null}

      {subtitle != null ? (
        <div className="mb-1.5 text-[11px] leading-tight text-muted-foreground">{subtitle}</div>
      ) : null}

      {rows && rows.length > 0 ? (
        <div className="space-y-1">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-4 text-xs">
              <span
                className={cn(
                  'flex min-w-0 items-center gap-1.5',
                  r.muted ? 'text-muted-foreground/80' : 'text-muted-foreground',
                )}
              >
                {r.color ? (
                  <span
                    className="size-2 shrink-0 rounded-sm"
                    style={{ backgroundColor: r.color }}
                    aria-hidden
                  />
                ) : null}
                <span className="truncate">{r.label}</span>
              </span>
              <span className="shrink-0 font-medium tabular-nums text-foreground">{r.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {children}

      {footer != null ? (
        <div className="mt-1.5 border-t pt-1.5 text-[11px] text-muted-foreground">{footer}</div>
      ) : null}
    </div>
  );
}

// ── Charts custom: estado de hover + posición ────────────────────────────────

type TooltipState<T> = { data: T; x: number; y: number };

/**
 * Maneja el hover de un chart custom. `bind(data)` devuelve los handlers de mouse
 * para cada marca (barra, punto, celda…). El tooltip sigue el cursor.
 */
export function useChartTooltip<T>() {
  const [tip, setTip] = useState<TooltipState<T> | null>(null);

  const bind = (data: T) => ({
    onMouseEnter: (e: { clientX: number; clientY: number }) =>
      setTip({ data, x: e.clientX, y: e.clientY }),
    onMouseMove: (e: { clientX: number; clientY: number }) =>
      setTip({ data, x: e.clientX, y: e.clientY }),
    onMouseLeave: () => setTip(null),
  });

  return { tip, bind, hide: () => setTip(null) };
}

/**
 * Posiciona la tarjeta del tooltip en coordenadas de viewport (fixed) via portal a
 * `document.body`, con clamp a los bordes y flip vertical si está muy arriba. Así
 * nunca queda recortada por el `overflow` del contenedor del gráfico.
 */
export function ChartTooltipPortal({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || typeof document === 'undefined') return null;

  const vw = window.innerWidth;
  const clampedX = Math.max(96, Math.min(x, vw - 96));
  const flipDown = y < 120;

  return createPortal(
    <div
      className="pointer-events-none fixed z-[60]"
      style={{
        left: clampedX,
        top: y,
        transform: flipDown
          ? 'translate(-50%, 16px)'
          : 'translate(-50%, calc(-100% - 14px))',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

// ── recharts: tipos para escribir contenido custom que reusa la tarjeta ──────

/** Un ítem del `payload` que recharts inyecta en el contenido del tooltip. */
export type RechartsPayloadItem = {
  name?: string | number;
  value?: string | number;
  color?: string;
  fill?: string;
  dataKey?: string | number;
  /** El datum completo de la fila (lo que se pasó a `data`). */
  payload?: Record<string, unknown>;
};

/**
 * Props que recharts inyecta a un componente pasado como `<Tooltip content=...>`.
 * Cada gráfico recharts define su propio contenido leyendo `payload[0].payload`
 * (el datum) y lo renderiza con `ChartTooltipCard` para un estilo consistente.
 */
export type RechartsContentProps = {
  active?: boolean;
  payload?: RechartsPayloadItem[];
  label?: string | number;
};
