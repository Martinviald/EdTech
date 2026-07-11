import type { LucideIcon } from 'lucide-react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// TKT-21 — Patrón "métrica comparada": un número clave presentado JUNTO a su(s)
// comparación(es), para dar contexto inmediato ("¿esto es bueno o malo?").
//
// Dimensión VIABLE hoy: delta vs el propio histórico de la org (comparación
// generacional / progresión que ya existe). Se modela como una LISTA de deltas
// (`comparisons`) precisamente para dejar el punto de extensión abierto: cuando
// exista el pool multi-colegio (TKT-20), la comparación vs "muestra de colegios"
// (benchmark inter-colegio) se agrega como un delta más, sin tocar el componente.
// Esa dimensión queda DIFERIDA por ahora.
// ─────────────────────────────────────────────────────────────────────────────

/** Una comparación de la métrica contra una referencia (histórico hoy; benchmark futuro). */
export type MetricDelta = {
  /** Diferencia en las unidades de la métrica (p. ej. puntos %). `null` = sin dato. */
  value: number | null;
  /** Etiqueta de la referencia comparada. Ej: "vs 2024", "vs muestra". */
  label: string;
  /** Si un delta positivo es "bueno" (verde). Default `true`. Para métricas donde
   *  bajar es mejor (p. ej. alumnos en riesgo), pasar `false`. */
  higherIsBetter?: boolean;
  /** Formateo del valor del delta (sin signo). Default: 1 decimal. */
  format?: (value: number) => string;
};

interface MetricComparisonProps {
  label: string;
  /** Valor principal ya formateado para mostrar (p. ej. "72.4%"). */
  value: string;
  /** Comparaciones a mostrar como chips. Vacío = sólo el valor, sin contexto. */
  comparisons?: MetricDelta[];
  hint?: string;
  icon?: LucideIcon;
}

function defaultFormat(value: number): string {
  return `${Math.abs(value).toFixed(1)}`;
}

/** Tono del delta según dirección y si "más es mejor". `0` (o null) = neutro. */
function deltaTone(value: number | null, higherIsBetter: boolean): 'up' | 'down' | 'flat' {
  if (value === null || value === 0 || Number.isNaN(value)) return 'flat';
  const isGood = value > 0 ? higherIsBetter : !higherIsBetter;
  return isGood ? 'up' : 'down';
}

const TONE_CLASS: Record<'up' | 'down' | 'flat', string> = {
  up: 'text-emerald-700 dark:text-emerald-300',
  down: 'text-red-700 dark:text-red-300',
  flat: 'text-muted-foreground',
};

function DeltaChip({ delta }: { delta: MetricDelta }): React.JSX.Element {
  const higherIsBetter = delta.higherIsBetter ?? true;
  const tone = deltaTone(delta.value, higherIsBetter);
  const format = delta.format ?? defaultFormat;
  const Icon = tone === 'up' ? TrendingUp : tone === 'down' ? TrendingDown : Minus;
  const sign = delta.value === null || delta.value === 0 ? '' : delta.value > 0 ? '+' : '−';

  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <Icon className={cn('size-3.5', TONE_CLASS[tone])} aria-hidden />
      <span className={cn('font-medium tabular-nums', TONE_CLASS[tone])}>
        {delta.value === null ? '—' : `${sign}${format(delta.value)}`}
      </span>
      <span className="text-muted-foreground">{delta.label}</span>
    </span>
  );
}

/**
 * Card de métrica con su comparación embebida (valor + deltas). Sin estado →
 * Server Component. Reutilizable en cualquier vista con números clave.
 */
export function MetricComparison({
  label,
  value,
  comparisons = [],
  hint,
  icon: Icon,
}: MetricComparisonProps): React.JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
          {comparisons.length > 0 ? (
            <div className="flex flex-col gap-0.5 pt-0.5">
              {comparisons.map((c) => (
                <DeltaChip key={c.label} delta={c} />
              ))}
            </div>
          ) : null}
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {Icon ? (
          <div className="rounded-lg bg-muted p-2">
            <Icon className="size-5 text-muted-foreground" aria-hidden />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
