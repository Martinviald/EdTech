import type { GradingScaleTypeValue } from '@soe/types';

export const SCALE_TYPE_LABELS: Record<GradingScaleTypeValue, string> = {
  linear_chilean: 'Lineal chilena (1.0 — 7.0)',
  percentage: 'Porcentaje',
  paes_scaled: 'PAES escalada',
  irt_based: 'Basada en IRT',
  custom: 'Personalizada',
};

/**
 * Formatea un valor decimal (que viene como string desde la API por la
 * columna `decimal` de Postgres) con un decimal: "4.0", "6.5".
 */
export function formatGrade(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(1);
}

/**
 * Formatea el `passingThreshold` (0..1) como porcentaje: "0.60" → "60%".
 */
export function formatThresholdPercent(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n * 100)}%`;
}
