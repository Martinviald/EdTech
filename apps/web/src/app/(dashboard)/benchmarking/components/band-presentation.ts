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
  insufficient: 'bg-red-500 dark:bg-red-600',
  elementary: 'bg-amber-500 dark:bg-amber-600',
  adequate: 'bg-emerald-500 dark:bg-emerald-600',
  advanced: 'bg-blue-500 dark:bg-blue-600',
};

/** Clase de chip (texto + fondo) por banda, para leyendas. */
export const BENCHMARK_BAND_BADGE_CLASS: Record<BenchmarkBandKey, string> = {
  insufficient:
    'border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  elementary:
    'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  adequate:
    'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  advanced:
    'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
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
