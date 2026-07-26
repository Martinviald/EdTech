import type { BenchmarkBandDistribution } from '@soe/types';

// ─────────────────────────────────────────────────────────────────────────────
// Presentación de las bandas de desempeño del benchmarking (H7.5). Las claves
// coinciden con `BenchmarkBandDistribution` de @soe/types (insufficient /
// elementary / adequate / advanced). Colores via tokens Tailwind (sin hex inline)
// y consistentes con la escala de logro usada en el resto de la app.
// ─────────────────────────────────────────────────────────────────────────────

/** Clave de banda = clave del objeto `BenchmarkBandDistribution`. */
export type BenchmarkBandKey = keyof BenchmarkBandDistribution;

/** Orden canónico de menor a mayor logro. */
export const BENCHMARK_BAND_ORDER: readonly BenchmarkBandKey[] = [
  'insufficient',
  'elementary',
  'adequate',
  'advanced',
];

export const BENCHMARK_BAND_LABELS: Record<BenchmarkBandKey, string> = {
  insufficient: 'Insuficiente',
  elementary: 'Elemental',
  adequate: 'Adecuado',
  advanced: 'Avanzado',
};

/** Clase de relleno (barra) por banda, con soporte dark mode. */
export const BENCHMARK_BAND_BAR_CLASS: Record<BenchmarkBandKey, string> = {
  insufficient: 'bg-level-insufficient',
  elementary: 'bg-level-elementary',
  adequate: 'bg-level-adequate',
  advanced: 'bg-level-advanced',
};

/** Clase de chip (texto + fondo) por banda, para leyendas. */
export const BENCHMARK_BAND_BADGE_CLASS: Record<BenchmarkBandKey, string> = {
  insufficient: 'border-transparent bg-level-insufficient/15 text-level-insufficient',
  elementary: 'border-transparent bg-level-elementary/15 text-level-elementary',
  adequate: 'border-transparent bg-level-adequate/15 text-level-adequate',
  advanced: 'border-transparent bg-level-advanced/15 text-level-advanced',
};

/** Total de alumnos sumando todas las bandas de una distribución. */
export function bandDistributionTotal(dist: BenchmarkBandDistribution): number {
  return BENCHMARK_BAND_ORDER.reduce((acc, key) => acc + dist[key], 0);
}

/** Porcentaje (0..100) de una banda dentro de su distribución. */
export function bandPercentage(
  dist: BenchmarkBandDistribution,
  key: BenchmarkBandKey,
): number {
  const total = bandDistributionTotal(dist);
  if (total <= 0) return 0;
  return (dist[key] / total) * 100;
}

/** Formatea un % de logro 0..100 (o null) con un decimal. */
export function formatAchievement(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}%`;
}

/** Formatea un percentil 0..100 (o null) como entero con sufijo. */
export function formatPercentile(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `P${Math.round(value)}`;
}

/** Cuartil cualitativo a partir del percentil (sin ranking público 1-N). */
export function percentileQuartileLabel(value: number | null): string | null {
  if (value === null || Number.isNaN(value)) return null;
  if (value >= 75) return 'Cuartil superior de la cohorte';
  if (value >= 50) return 'Sobre la mediana de la cohorte';
  if (value >= 25) return 'Bajo la mediana de la cohorte';
  return 'Cuartil inferior de la cohorte';
}
