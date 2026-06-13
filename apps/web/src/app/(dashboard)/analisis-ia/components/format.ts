/** Helpers de formateo locales para las tarjetas del análisis IA. */

/** p / D / punto-biserial → 2 decimales; null → guion. */
export function formatMetric(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return value.toFixed(2);
}

/** % de logro (0..1 o 0..100). Acepta proporción o porcentaje ya escalado. */
export function formatAchievement(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}%`;
}

const PRIORITY_LABEL: Record<'high' | 'medium' | 'low', string> = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};

export function priorityLabel(priority: 'high' | 'medium' | 'low'): string {
  return PRIORITY_LABEL[priority];
}

export function priorityTone(
  priority: 'high' | 'medium' | 'low',
): 'destructive' | 'warning' | 'secondary' {
  if (priority === 'high') return 'destructive';
  if (priority === 'medium') return 'warning';
  return 'secondary';
}

const PRIORITY_RANK: Record<'high' | 'medium' | 'low', number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function priorityRank(priority: 'high' | 'medium' | 'low'): number {
  return PRIORITY_RANK[priority];
}

const CAUSE_LABEL: Record<string, string> = {
  not_taught: 'No enseñado',
  misconception: 'Error conceptual',
  item_quality: 'Calidad del ítem',
  insufficient_practice: 'Práctica insuficiente',
};

export function causeLabel(cause: string): string {
  return CAUSE_LABEL[cause] ?? cause;
}
