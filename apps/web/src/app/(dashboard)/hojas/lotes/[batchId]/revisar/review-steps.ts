import type { Step } from '@/components/shared';

/**
 * Los pasos de la corrección de un lote. El primero no tiene acción humana (lo
 * hace el lector); los del medio son el trabajo de revisión y el último cierra
 * el lote. "Respuestas escritas" solo aparece cuando el lote tiene lecturas por
 * visión de preguntas abiertas.
 */
export const REVIEW_STEP_IDS = [
  'procesar',
  'paginas',
  'marcas',
  'respuestas',
  'finalizar',
] as const;
export type ReviewStepId = (typeof REVIEW_STEP_IDS)[number];

const REVIEW_STEP_LABELS: Record<ReviewStepId, string> = {
  procesar: 'Procesando',
  paginas: 'Revisar páginas',
  marcas: 'Marcas dudosas',
  respuestas: 'Respuestas escritas',
  finalizar: 'Revisar y finalizar',
};

export function visibleReviewStepIds(hasWrittenAnswers: boolean): ReviewStepId[] {
  return REVIEW_STEP_IDS.filter((id) => hasWrittenAnswers || id !== 'respuestas');
}

export function reviewStepsFor(stepIds: readonly ReviewStepId[]): Step[] {
  return stepIds.map((id) => ({ id, label: REVIEW_STEP_LABELS[id] }));
}

/** Parámetro de la URL que recuerda el paso, para no perder el lugar al volver al lote. */
export const REVIEW_STEP_PARAM = 'paso';

export function parseReviewStep(value: string | null): ReviewStepId | null {
  const found = REVIEW_STEP_IDS.find((id) => id === value);
  return found ?? null;
}
