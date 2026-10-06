import type { BenchmarkBandCount, PerformanceLevel } from '@soe/types';
import { bandLegacyLevel } from '@/components/official-reports/band-levels';

// ─────────────────────────────────────────────────────────────────────────────
// Presentación de las bandas del benchmarking (H7.5) en los niveles PROPIOS del
// instrumento (`band_counts`, p. ej. DIA Nivel I/II/III), los mismos que muestran las
// vistas de resultados. El color se hereda de la escala de logro por la posición de
// la banda dentro del set (`bandLegacyLevel`); la etiqueta es siempre la real.
// ─────────────────────────────────────────────────────────────────────────────

const LEVEL_BAR_CLASS: Record<PerformanceLevel, string> = {
  insufficient: 'bg-level-insufficient',
  elementary: 'bg-level-elementary',
  adequate: 'bg-level-adequate',
  advanced: 'bg-level-advanced',
};

const LEVEL_BADGE_CLASS: Record<PerformanceLevel, string> = {
  insufficient: 'border-transparent bg-level-insufficient/15 text-level-insufficient',
  elementary: 'border-transparent bg-level-elementary/15 text-level-elementary',
  adequate: 'border-transparent bg-level-adequate/15 text-level-adequate',
  advanced: 'border-transparent bg-level-advanced/15 text-level-advanced',
};

/** Una banda del set, sin conteo (para leyendas y columnas). */
export type BenchmarkBandRef = { bandKey: string; label: string; order: number };

/** Unión de las bandas presentes en varias distribuciones, ordenada de menor a mayor. */
export function unionBands(lists: readonly (readonly BenchmarkBandCount[])[]): BenchmarkBandRef[] {
  const byKey = new Map<string, BenchmarkBandRef>();
  for (const list of lists) {
    for (const band of list) {
      if (!byKey.has(band.bandKey)) {
        byKey.set(band.bandKey, { bandKey: band.bandKey, label: band.label, order: band.order });
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.order - b.order);
}

/** % (0..100) por clave de banda dentro de una distribución. */
export function bandPercentages(counts: readonly BenchmarkBandCount[]): Map<string, number> {
  let total = 0;
  for (const band of counts) total += band.count;
  const result = new Map<string, number>();
  for (const band of counts) {
    result.set(band.bandKey, total > 0 ? (band.count / total) * 100 : 0);
  }
  return result;
}

export function bandBarClass(band: BenchmarkBandRef, bands: readonly BenchmarkBandRef[]): string {
  return LEVEL_BAR_CLASS[
    bandLegacyLevel(
      band.order,
      bands.map((b) => b.order),
    )
  ];
}

export function bandBadgeClass(band: BenchmarkBandRef, bands: readonly BenchmarkBandRef[]): string {
  return LEVEL_BADGE_CLASS[
    bandLegacyLevel(
      band.order,
      bands.map((b) => b.order),
    )
  ];
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
