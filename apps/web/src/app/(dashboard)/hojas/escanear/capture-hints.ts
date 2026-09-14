import type { PageRejectReason } from '@soe/types';

/**
 * Guía de captura anclada al modo de falla medido (docs/diseno-lector-de-marcas/09 y 10):
 * el detector elige el cuadrado de esquina equivocado cuando hay objetos oscuros en el fondo
 * —sobre todo otra hoja de respuestas del montón, que trae sus propias marcas de esquina—.
 * El área que ocupa la hoja en el encuadre NO separa los casos que funcionan de los que fallan,
 * así que estos textos nunca piden "acércate" ni "encuadra mejor".
 */
export const CLEAR_SURFACE_TIP =
  'Pon la hoja sola sobre una superficie despejada, sin otras hojas al lado.';

export const CLEAR_SURFACE_REASON =
  'El lector se guía por las marcas negras de las esquinas y puede tomar las de la hoja de abajo como si fueran de esta.';

/** Micro-copia permanente bajo la vista previa. Una línea, sin pedir un encuadre distinto. */
export const CAPTURE_FRAMING_TIP = `${CLEAR_SURFACE_TIP} Debe verse completa dentro del marco, plana y sin reflejos.`;

const GENERIC_RETAKE_HINT = 'Vuelve a tomarla con la hoja completa, plana y bien iluminada.';

const REJECT_REASON_CAPTURE_HINTS: Record<PageRejectReason, string> = {
  blurry: 'Apoya el codo o el teléfono, espera a que la cámara enfoque y vuelve a tomarla.',
  glare: 'Cambia de posición para que la luz no rebote sobre la hoja y vuelve a tomarla.',
  fiducials_missing: `${CLEAR_SURFACE_TIP} ${CLEAR_SURFACE_REASON}`,
  cropped: `Revisa que la hoja se vea entera y que no haya otras hojas al lado. ${CLEAR_SURFACE_REASON}`,
  no_separable_marks: GENERIC_RETAKE_HINT,
};

/** Qué hacer con la foto rechazada, según el motivo del control de calidad. */
export function rejectionHint(reason: PageRejectReason | null): string {
  return reason ? REJECT_REASON_CAPTURE_HINTS[reason] : GENERIC_RETAKE_HINT;
}

// ── Hoja que no corresponde a la tirada ──────────────────────────────────────
// La imagen puede estar perfecta: el problema es el papel, no la foto. Decirle a
// quien captura que "la calidad es mala" lo manda a repetir una foto que estaba
// bien, una y otra vez.

export const FOREIGN_SHEET_TITLE = 'Esta hoja no es de esta tirada';

export const FOREIGN_SHEET_REASON =
  'La foto salió bien, pero el código impreso en la hoja pertenece a otra tirada.';

export const FOREIGN_SHEET_HINT =
  'Usa las hojas que imprimiste para esta tirada. Las otras se capturan abriendo una sesión sobre su propia tirada.';
