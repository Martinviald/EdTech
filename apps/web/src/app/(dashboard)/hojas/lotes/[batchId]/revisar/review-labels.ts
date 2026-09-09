import type { DoubtReason, MarksReadability, MarkState, PageRejectReason } from '@soe/types';

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
