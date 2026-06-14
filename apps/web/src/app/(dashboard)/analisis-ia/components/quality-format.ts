import type { ItemQualityFlag } from '@soe/types';

// Etiquetas y tono de las banderas de calidad de ítem (H20.9). Compartidas entre
// el panel en pantalla y el export (Excel/PDF).

export const FLAG_LABELS: Record<ItemQualityFlag, string> = {
  low_discrimination: 'Baja discriminación',
  ambiguous_key: 'Clave ambigua',
  strong_distractor: 'Distractor potente',
  too_easy: 'Muy fácil',
  misaligned: 'Sin alineación',
};

/** Tono visual del chip de cada flag (tokens Tailwind via Badge variant). */
export function flagTone(
  flag: ItemQualityFlag,
): 'destructive' | 'warning' | 'secondary' {
  if (flag === 'ambiguous_key' || flag === 'low_discrimination')
    return 'destructive';
  if (flag === 'strong_distractor' || flag === 'misaligned') return 'warning';
  return 'secondary'; // too_easy
}

/** % con 0 decimales; null → guion. */
export function fmtPctInt(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${Math.round(value)}%`;
}

/** Métrica con N decimales; null → guion. */
export function fmtMetric(value: number | null, digits = 2): string {
  if (value === null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}
