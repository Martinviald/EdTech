import type { PerformanceLevel } from '@soe/types';

// Etiquetas y orden de niveles de desempeño (compartido por charts FE-B).
export const PERFORMANCE_LEVEL_ORDER: PerformanceLevel[] = [
  'insufficient',
  'elementary',
  'adequate',
  'advanced',
];

export const PERFORMANCE_LEVEL_LABELS: Record<PerformanceLevel, string> = {
  insufficient: 'Insuficiente',
  elementary: 'Elemental',
  adequate: 'Adecuado',
  advanced: 'Avanzado',
};

// Colores por nivel basados en tokens semánticos (vía hsl(var(--token))).
export const PERFORMANCE_LEVEL_COLOR: Record<PerformanceLevel, string> = {
  insufficient: 'hsl(var(--destructive))',
  elementary: 'hsl(var(--secondary-foreground))',
  adequate: 'hsl(var(--accent))',
  advanced: 'hsl(var(--primary))',
};
