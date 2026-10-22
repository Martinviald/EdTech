import type {
  DoubtReason,
  MarksReadability,
  MarkState,
  PageRejectReason,
  ReviewMarkAiResolutionModel,
  ReviewMarkModel,
} from '@soe/types';

export const REJECT_REASON_LABELS: Record<PageRejectReason, string> = {
  blurry: 'Imagen borrosa',
  glare: 'Reflejo sobre la hoja',
  fiducials_missing: 'No se detectaron las marcas de las esquinas',
  cropped: 'La página salió recortada en la captura',
  no_separable_marks: 'No se distinguen marcas legibles en la página',
};

export const MARKS_READABILITY_LABELS: Record<MarksReadability, string> = {
  readable: 'Las marcas se distinguen',
  likely_blank: 'La hoja parece no tener respuestas marcadas',
  unreadable: 'No se distinguen las marcas. Busca luz más pareja o evita la sombra sobre la hoja',
};

export const MARK_STATE_LABELS: Record<MarkState, string> = {
  marked: 'Marcada',
  blank: 'En blanco',
  multiple: 'Doble marca',
  ambiguous: 'Marca dudosa',
};

export const DOUBT_REASON_LABELS: Record<DoubtReason, string> = {
  margin: 'el relleno quedó muy cerca del umbral de la hoja',
  band: 'el relleno quedó a medio camino entre marcado y vacío',
  multiple: 'hay más de una burbuja marcada',
};

export const AI_CONFLICT_LABEL = 'Los modelos no coinciden';
export const EVIDENT_DOUBLE_MARK_LABEL = 'Doble marca evidente';

const AI_AGREEMENT_LABELS = {
  both: 'dos modelos coinciden',
  single: 'un modelo seguro',
} as const;

function aiValueLabel(value: string | null): string {
  if (value === 'blank') return 'en blanco';
  if (value === 'null' || value === null) return 'nula';
  return value;
}

/** Distintivo de la resolución con IA de una marca; `null` si no hay nada que mostrar. */
export function aiResolutionLabel(resolution: ReviewMarkAiResolutionModel | null): string | null {
  if (!resolution) return null;
  if (resolution.verdict === 'conflict') return AI_CONFLICT_LABEL;
  const agreement = resolution.agreement ? AI_AGREEMENT_LABELS[resolution.agreement] : null;
  const base = `IA: ${aiValueLabel(resolution.value)}`;
  return agreement ? `${base} (${agreement})` : base;
}

/** Distintivo de procedencia de una marca: IA, conflicto de modelos o doble marca evidente. */
export function markOriginLabel(
  mark: Pick<ReviewMarkModel, 'aiResolution' | 'autoResolved'>,
): string | null {
  const ai = aiResolutionLabel(mark.aiResolution);
  if (ai) return ai;
  return mark.autoResolved ? EVIDENT_DOUBLE_MARK_LABEL : null;
}

export type AutoResolvedCounts = { byAi: number; evident: number };

export function countAutoResolved(
  marks: ReadonlyArray<Pick<ReviewMarkModel, 'aiResolution'>>,
): AutoResolvedCounts {
  const byAi = marks.filter((mark) => mark.aiResolution !== null).length;
  return { byAi, evident: marks.length - byAi };
}

/** Texto del callout de marcas resueltas solas; sin IA no la menciona. */
export function autoResolvedSummary({ byAi, evident }: AutoResolvedCounts): string {
  const keep = 'No requieren revisión; quedan al final de la lista por si quieres corregir alguna.';
  if (byAi === 0) {
    const head =
      evident === 1
        ? 'Una doble marca evidente se anuló sola'
        : `${evident} dobles marcas evidentes se anularon solas`;
    return `${head} (ambas burbujas rellenas). ${keep}`;
  }
  return `Resueltas automáticamente: ${byAi} por IA, ${evident} dobles marcas evidentes. ${keep}`;
}
