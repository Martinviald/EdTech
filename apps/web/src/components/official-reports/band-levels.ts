import type { PerformanceLevel } from '@soe/types';
import {
  PERFORMANCE_LEVEL_BADGE_CLASS,
  PERFORMANCE_LEVEL_ORDER,
} from '@/app/(dashboard)/resultados/components/performance-level';

/**
 * Nivel legacy equivalente de una banda por la posición relativa de su `order`
 * dentro del set (misma proyección que `bandToLegacyLevel` del backend). Sólo se
 * usa para heredar el color/estilo de la paleta de niveles cuando la banda no trae
 * un color propio — la etiqueta mostrada es SIEMPRE la real de la banda.
 */
export function bandLegacyLevel(order: number, orders: readonly number[]): PerformanceLevel {
  const n = orders.length;
  if (n <= 1) return 'adequate';
  const sorted = [...orders].sort((a, b) => a - b);
  const idx = sorted.indexOf(order);
  const ratio = idx / (n - 1);
  const bucket = Math.min(
    PERFORMANCE_LEVEL_ORDER.length - 1,
    Math.round(ratio * (PERFORMANCE_LEVEL_ORDER.length - 1)),
  );
  return PERFORMANCE_LEVEL_ORDER[bucket]!;
}

/** Clase de badge (color) de una banda según su posición dentro del set. */
export function bandBadgeClass(order: number, orders: readonly number[]): string {
  return PERFORMANCE_LEVEL_BADGE_CLASS[bandLegacyLevel(order, orders)];
}
