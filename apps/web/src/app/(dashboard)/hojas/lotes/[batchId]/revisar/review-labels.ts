import type { MarkState, PageRejectReason } from '@soe/types';

export const REJECT_REASON_LABELS: Record<PageRejectReason, string> = {
  blurry: 'Imagen borrosa',
  glare: 'Reflejo sobre la hoja',
  fiducials_missing: 'No se detectaron las marcas de las esquinas',
  cropped: 'La página salió recortada en la captura',
  no_separable_marks: 'No se distinguen marcas legibles en la página',
};

export const MARK_STATE_LABELS: Record<MarkState, string> = {
  marked: 'Marcada',
  blank: 'En blanco',
  multiple: 'Doble marca',
  ambiguous: 'Marca dudosa',
};
