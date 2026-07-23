import type { PerformanceLevel } from '@soe/types';

/**
 * Mapa central de presentación de niveles de desempeño (H6.4). Único punto de
 * verdad para etiquetas y colores: las páginas y badges lo reusan para que la
 * codificación de color sea consistente en toda la app.
 *
 * Colores via tokens Tailwind (NO hardcodeados):
 *   insufficient → rojo (destructive)   elementary → ámbar (amber/warning)
 *   adequate     → verde (emerald)      advanced   → azul (info/blue)
 */
export const PERFORMANCE_LEVEL_LABELS: Record<PerformanceLevel, string> = {
  insufficient: 'Insuficiente',
  elementary: 'Elemental',
  adequate: 'Adecuado',
  advanced: 'Avanzado',
};

/** Orden canónico de menor a mayor logro, para iterar distribuciones. */
export const PERFORMANCE_LEVEL_ORDER: readonly PerformanceLevel[] = [
  'insufficient',
  'elementary',
  'adequate',
  'advanced',
];

/** Clases de badge (texto + fondo) por nivel, vía tokens `--level-*` (theme-aware). */
export const PERFORMANCE_LEVEL_BADGE_CLASS: Record<PerformanceLevel, string> = {
  insufficient: 'border-transparent bg-level-insufficient/15 text-level-insufficient',
  elementary: 'border-transparent bg-level-elementary/15 text-level-elementary',
  adequate: 'border-transparent bg-level-adequate/15 text-level-adequate',
  advanced: 'border-transparent bg-level-advanced/15 text-level-advanced',
};

/** Clase de relleno (barra) por nivel, para la distribución apilada. Vía tokens. */
export const PERFORMANCE_LEVEL_BAR_CLASS: Record<PerformanceLevel, string> = {
  insufficient: 'bg-level-insufficient',
  elementary: 'bg-level-elementary',
  adequate: 'bg-level-adequate',
  advanced: 'bg-level-advanced',
};

/**
 * Color concreto (hex) por nivel para gráficos recharts, que necesitan un valor
 * de `fill` y no aceptan clases Tailwind. Equivalen exactamente a la paleta de
 * `PERFORMANCE_LEVEL_BAR_CLASS` (red-500 / amber-500 / emerald-500 / blue-500)
 * para que un mismo nivel se vea idéntico en barras y en charts.
 */
export const PERFORMANCE_LEVEL_CHART_COLOR: Record<PerformanceLevel, string> = {
  insufficient: '#ef4444', // red-500
  elementary: '#f59e0b', // amber-500
  adequate: '#10b981', // emerald-500
  advanced: '#3b82f6', // blue-500
};

export function performanceLevelLabel(level: PerformanceLevel | null): string {
  return level ? PERFORMANCE_LEVEL_LABELS[level] : 'Sin datos';
}

/** Formatea un porcentaje 0..100 (o null) a string con un decimal. */
export function formatAchievement(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}%`;
}

// ── Bandas de desempeño como datos (#2) ──────────────────────────────────────
// El sistema ya no asume 4 niveles fijos. Cuando un instrumento/escala define
// bandas configurables (SIMCE 3, Cambridge CEFR 6, etc.), la UI las deriva de
// estos datos. Si no hay bandas, se cae a los 4 niveles DIA por defecto, de modo
// que la vista actual (heatmap, distribution-bar, badges) NO cambia.

/** Vista mínima de una banda de desempeño servida por la API. */
export type PerformanceBandView = {
  key: string;
  label: string;
  order: number;
  /** Color de presentación: token Tailwind o hex. Opcional. */
  color?: string | null;
};

/**
 * Etiqueta de una banda. Prioriza la banda (dato); si no hay banda pero sí un
 * `PerformanceLevel` DIA, usa el mapa estático; si no, 'Sin datos'.
 */
export function bandLabel(
  band: PerformanceBandView | null | undefined,
  fallbackLevel: PerformanceLevel | null = null,
): string {
  if (band) return band.label;
  return performanceLevelLabel(fallbackLevel);
}

/**
 * Color (hex) de una banda para charts. Si la banda trae un color hex lo usa; si
 * no, cae al color del nivel DIA equivalente, o a un gris neutro.
 */
export function bandChartColor(
  band: PerformanceBandView | null | undefined,
  fallbackLevel: PerformanceLevel | null = null,
): string {
  if (band?.color && band.color.startsWith('#')) return band.color;
  if (fallbackLevel) return PERFORMANCE_LEVEL_CHART_COLOR[fallbackLevel];
  return '#94a3b8'; // slate-400 neutro
}

/**
 * ¿La lista de bandas corresponde al esquema DIA por defecto (4 niveles)? Permite
 * a los consumidores decidir si renderizan con el mapa estático o con datos.
 */
export function isDefaultDiaBands(bands: PerformanceBandView[] | null | undefined): boolean {
  if (!bands || bands.length !== PERFORMANCE_LEVEL_ORDER.length) return false;
  const keys = bands.map((b) => b.key).sort();
  const expected = [...PERFORMANCE_LEVEL_ORDER].sort();
  return keys.every((k, i) => k === expected[i]);
}
