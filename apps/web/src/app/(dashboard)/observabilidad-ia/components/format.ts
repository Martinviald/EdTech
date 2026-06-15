// ─────────────────────────────────────────────────────────────────────────────
// H19.25 — Helpers de formato compartidos por los componentes del panel de
// observabilidad IA. Montos en USD (es-CL), tokens y latencia legibles.
// ─────────────────────────────────────────────────────────────────────────────

const usdFormatter = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const integerFormatter = new Intl.NumberFormat('es-CL');

/** Formatea un monto en USD (ej. US$0,0123). */
export function formatUsd(value: number): string {
  return usdFormatter.format(value);
}

/** Formatea un entero con separadores de miles (ej. 12.345). */
export function formatInt(value: number): string {
  return integerFormatter.format(value);
}

/** Latencia legible: ms < 1000, si no segundos con 1 decimal. null → "—". */
export function formatLatency(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${formatInt(Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Porcentaje legible (ej. 85,3%). null → "—". */
export function formatPct(value: number | null): string {
  if (value === null) return '—';
  return `${value.toFixed(1)}%`;
}
