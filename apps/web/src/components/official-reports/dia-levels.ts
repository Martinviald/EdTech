// ─────────────────────────────────────────────────────────────────────────────
// Mapeo de los 4 niveles de la plataforma (`performance_level`) a los 3 niveles
// de logro del formato oficial (I / II / III), tal como lo documenta el contrato
// compartido (`official-report-common.schema.ts`): la plataforma modela 4 niveles
// y el frontend aplica el colapso I/II/III sobre ellos. Cuando en el futuro se
// configuren `performance_bands` por instrumento, este mapeo se refina sin tocar
// el contrato.
// ─────────────────────────────────────────────────────────────────────────────

import type { PerformanceLevel } from '@soe/types';
import {
  PERFORMANCE_LEVEL_BADGE_CLASS,
  PERFORMANCE_LEVEL_BAR_CLASS,
} from '@/app/(dashboard)/resultados/components/performance-level';

/** Numeral de nivel de logro del formato oficial. */
export type DiaLevel = 'I' | 'II' | 'III';

/** Orden canónico de menor a mayor logro (filas de las Tablas 1.1–1.4). */
export const DIA_LEVEL_ORDER: readonly DiaLevel[] = ['I', 'II', 'III'];

/**
 * A qué numeral I/II/III cae cada nivel de la plataforma:
 * - insufficient → I (no logra los aprendizajes mínimos)
 * - elementary   → II (logro parcial)
 * - adequate + advanced → III (logro satisfactorio)
 */
export const DIA_LEVEL_OF: Record<PerformanceLevel, DiaLevel> = {
  insufficient: 'I',
  elementary: 'II',
  adequate: 'III',
  advanced: 'III',
};

/** Nivel de la plataforma "representante" de cada numeral, para reusar su color. */
const REPRESENTATIVE_LEVEL: Record<DiaLevel, PerformanceLevel> = {
  I: 'insufficient',
  II: 'elementary',
  III: 'adequate',
};

export const DIA_LEVEL_LABELS: Record<DiaLevel, string> = {
  I: 'Nivel I',
  II: 'Nivel II',
  III: 'Nivel III',
};

/** Clase de badge (color) coherente con el resto de la app, por numeral. */
export function diaLevelBadgeClass(level: DiaLevel): string {
  return PERFORMANCE_LEVEL_BADGE_CLASS[REPRESENTATIVE_LEVEL[level]];
}

/** Clase de relleno (barra) por numeral. */
export function diaLevelBarClass(level: DiaLevel): string {
  return PERFORMANCE_LEVEL_BAR_CLASS[REPRESENTATIVE_LEVEL[level]];
}
