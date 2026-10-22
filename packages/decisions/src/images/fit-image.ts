/**
 * Ajuste de una imagen a las restricciones de un motor (`DecisionEngineLimits.imageConstraints`).
 *
 * Lo usa el adaptador, no el consumidor: el reescalado depende del motor (ampliar
 * un recorte chico ayuda a Jev y perjudica a OpenAI), así que el consumidor manda
 * siempre la imagen original y cada adaptador decide.
 *
 * Regla (calibrada en la PoC de marcas, `run_poc.py`):
 * 1. Escalar para que el lado menor quede en `targetMinSidePx` (Lanczos).
 * 2. Si el lado mayor supera `maxSidePx`, bajar a `maxSidePx` y rellenar en blanco
 *    el lado menor hasta `minSidePx` (relación de aspecto mayor que max/min).
 * 3. Codificar en JPEG calidad 92.
 *
 * Ejemplo: 250×68 → 1103×300.
 */

import sharp from 'sharp';

import { DecisionError, type ImageConstraints } from '../contracts';

/** Calidad JPEG de la PoC. */
export const FIT_IMAGE_JPEG_QUALITY = 92;

export interface FittedImage {
  readonly data: Buffer;
  readonly mimeType: 'image/jpeg';
  readonly width: number;
  readonly height: number;
}

/** Tamaño final (antes del relleno) y relleno por lado, en px. */
export interface FitPlan {
  readonly width: number;
  readonly height: number;
  readonly padWidth: number;
  readonly padHeight: number;
}

/**
 * Calcula el tamaño de salida para una imagen de `width`×`height`. Puro: no toca bytes.
 * Lanza `invalid_request` si la imagen no tiene tamaño o si el resultado no cabe en
 * las restricciones (no debería pasar con restricciones coherentes).
 */
export function planFit(
  width: number,
  height: number,
  constraints: ImageConstraints,
  targetMinSidePx: number,
): FitPlan {
  if (!(width > 0) || !(height > 0)) {
    throw new DecisionError('invalid_request', 'La imagen no tiene un tamaño válido.');
  }
  const target = Math.min(Math.max(targetMinSidePx, constraints.minSidePx), constraints.maxSidePx);
  let scale = target / Math.min(width, height);
  if (Math.max(width, height) * scale > constraints.maxSidePx) {
    scale = constraints.maxSidePx / Math.max(width, height);
  }
  const scaledWidth = Math.max(1, Math.round(width * scale));
  const scaledHeight = Math.max(1, Math.round(height * scale));
  const padWidth = Math.max(0, constraints.minSidePx - scaledWidth);
  const padHeight = Math.max(0, constraints.minSidePx - scaledHeight);

  const finalWidth = scaledWidth + padWidth;
  const finalHeight = scaledHeight + padHeight;
  const pixels = finalWidth * finalHeight;
  if (
    finalWidth > constraints.maxSidePx ||
    finalHeight > constraints.maxSidePx ||
    pixels < constraints.minPixels ||
    pixels > constraints.maxPixels
  ) {
    throw new DecisionError(
      'invalid_request',
      `No se pudo ajustar la imagen de ${width}×${height} a las restricciones del motor.`,
    );
  }
  return { width: scaledWidth, height: scaledHeight, padWidth, padHeight };
}

/**
 * Ajusta los bytes de una imagen (PNG, JPEG u otro formato que lea `sharp`) a las
 * restricciones y la devuelve como JPEG. Lanza `invalid_request` si no se puede leer
 * o si el archivo final supera `maxBytes`.
 */
export async function fitImage(
  bytes: Uint8Array,
  constraints: ImageConstraints,
  targetMinSidePx: number,
): Promise<FittedImage> {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(bytes).metadata();
  } catch (error) {
    throw new DecisionError('invalid_request', 'No se pudo leer la imagen.', error);
  }
  const { width, height } = orientedSize(metadata);
  const plan = planFit(width, height, constraints, targetMinSidePx);

  let data: Buffer;
  try {
    data = await sharp(bytes)
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize(plan.width, plan.height, { kernel: 'lanczos3', fit: 'fill' })
      .extend({
        top: Math.floor(plan.padHeight / 2),
        bottom: Math.ceil(plan.padHeight / 2),
        left: Math.floor(plan.padWidth / 2),
        right: Math.ceil(plan.padWidth / 2),
        background: '#ffffff',
      })
      .jpeg({ quality: FIT_IMAGE_JPEG_QUALITY })
      .toBuffer();
  } catch (error) {
    throw new DecisionError('invalid_request', 'No se pudo reescalar la imagen.', error);
  }
  if (data.byteLength > constraints.maxBytes) {
    throw new DecisionError(
      'invalid_request',
      `La imagen ajustada pesa ${data.byteLength} bytes; el máximo es ${constraints.maxBytes}.`,
    );
  }
  return {
    data,
    mimeType: 'image/jpeg',
    width: plan.width + plan.padWidth,
    height: plan.height + plan.padHeight,
  };
}

/** Ancho y alto tal como se ve la imagen (las orientaciones EXIF 5–8 intercambian ejes). */
function orientedSize(metadata: sharp.Metadata): { width: number; height: number } {
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const swapsAxes = metadata.orientation !== undefined && metadata.orientation >= 5;
  return swapsAxes ? { width: height, height: width } : { width, height };
}
