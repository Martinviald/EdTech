import type { Step } from '@/components/shared';

/**
 * Los cuatro pasos de la corrección de un lote. El primero no tiene acción
 * humana (lo hace el lector); los dos del medio son el trabajo de revisión y el
 * último cierra el lote.
 */
export const REVIEW_STEP_IDS = ['procesar', 'paginas', 'marcas', 'finalizar'] as const;
export type ReviewStepId = (typeof REVIEW_STEP_IDS)[number];

export const REVIEW_STEPS: Step[] = [
  { id: 'procesar', label: 'Procesando' },
  { id: 'paginas', label: 'Revisar páginas' },
  { id: 'marcas', label: 'Marcas dudosas' },
  { id: 'finalizar', label: 'Revisar y finalizar' },
];

export const REVIEW_STEP_INDEX: Record<ReviewStepId, number> = {
  procesar: 0,
  paginas: 1,
  marcas: 2,
  finalizar: 3,
};

/** Parámetro de la URL que recuerda el paso, para no perder el lugar al volver al lote. */
export const REVIEW_STEP_PARAM = 'paso';

export function parseReviewStep(value: string | null): ReviewStepId | null {
  const found = REVIEW_STEP_IDS.find((id) => id === value);
  return found ?? null;
}
