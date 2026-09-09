import {
  SHEET_QR_IDENTITY_REGION,
  type LayoutSpec,
  type OmrRegion,
} from '../schemas/omr-layout.schema';

/**
 * Dimensiones del papel en centésimas de pulgada. Misma tabla que usa el impresor
 * (pdf-lib) y la vista previa de la hoja: carta es 8,5 × 11", razón 17/22.
 */
export const SHEET_PAPER_DIMENSIONS: Record<
  LayoutSpec['paper'],
  { width: number; height: number }
> = {
  letter: { width: 850, height: 1100 },
  a4: { width: 827, height: 1169 },
  legal: { width: 850, height: 1400 },
};

/** Lado y margen del cuadrado de fiducial, como fracción del ANCHO de página. */
export const SHEET_FIDUCIAL_SIZE_RATIO = 0.025;
export const SHEET_FIDUCIAL_MARGIN_RATIO = 0.03;

/** Rectángulo en fracciones 0–1 de la PÁGINA (no del marco de fiduciales). */
export type SheetPageRect = { left: number; top: number; width: number; height: number };

export type SheetGuideGeometry = {
  /** ancho / alto del papel: lo que debe medir el marco del visor. */
  aspectRatio: number;
  /** Lado del cuadrado de fiducial, en fracción del ancho de página. */
  fiducialSize: number;
  /** Separación del cuadrado respecto del borde, en fracción del ancho de página. */
  fiducialMargin: number;
  /** Zona del QR, en fracciones de la página. */
  qr: SheetPageRect;
};

/**
 * Traduce la geometría del `LayoutSpec` a fracciones de la PÁGINA, que es lo que
 * necesita quien dibuja guías sobre una imagen de la hoja completa (el visor de
 * captura).
 *
 * ⚠️ Las coordenadas del spec (`identity.region`, burbujas) son fracciones del
 * rectángulo que forman los CENTROS de los cuatro fiduciales, no de la página
 * (ver `SheetPreview`). Sin esta conversión la zona del QR queda corrida hacia
 * adentro y hacia abajo respecto del QR impreso.
 */
export function sheetGuideGeometry(
  spec?: Pick<LayoutSpec, 'paper' | 'fiducials' | 'identity'>,
): SheetGuideGeometry {
  const paperName = spec?.paper ?? 'letter';
  const paper = SHEET_PAPER_DIMENSIONS[paperName];
  const sizeRatio = spec?.fiducials.sizeRatio ?? SHEET_FIDUCIAL_SIZE_RATIO;
  const marginRatio = spec?.fiducials.marginRatio ?? SHEET_FIDUCIAL_MARGIN_RATIO;
  const region: OmrRegion = spec?.identity.region ?? SHEET_QR_IDENTITY_REGION;

  const side = sizeRatio * paper.width;
  const margin = marginRatio * paper.width;
  // Origen del marco de referencia: el CENTRO del fiducial de la esquina.
  const centerOffset = margin + side / 2;
  const spanX = paper.width - 2 * centerOffset;
  const spanY = paper.height - 2 * centerOffset;

  const toPageX = (x: number) => (centerOffset + x * spanX) / paper.width;
  const toPageY = (y: number) => (centerOffset + y * spanY) / paper.height;

  const left = toPageX(region.topLeft.x);
  const top = toPageY(region.topLeft.y);

  return {
    aspectRatio: paper.width / paper.height,
    fiducialSize: sizeRatio,
    fiducialMargin: marginRatio,
    qr: {
      left,
      top,
      width: toPageX(region.bottomRight.x) - left,
      height: toPageY(region.bottomRight.y) - top,
    },
  };
}
