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

/** Clases de badge (texto + fondo) por nivel, con soporte dark mode. */
export const PERFORMANCE_LEVEL_BADGE_CLASS: Record<PerformanceLevel, string> = {
  insufficient:
    'border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  elementary:
    'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  adequate:
    'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  advanced:
    'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
};

/** Clase de relleno (barra) por nivel, para la distribución apilada. */
export const PERFORMANCE_LEVEL_BAR_CLASS: Record<PerformanceLevel, string> = {
  insufficient: 'bg-red-500 dark:bg-red-600',
  elementary: 'bg-amber-500 dark:bg-amber-600',
  adequate: 'bg-emerald-500 dark:bg-emerald-600',
  advanced: 'bg-blue-500 dark:bg-blue-600',
};

export function performanceLevelLabel(level: PerformanceLevel | null): string {
  return level ? PERFORMANCE_LEVEL_LABELS[level] : 'Sin datos';
}

/** Formatea un porcentaje 0..100 (o null) a string con un decimal. */
export function formatAchievement(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}%`;
}
