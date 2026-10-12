import { z } from 'zod';
import { omrRegionSchema, type OmrRegion } from '../omr-geometry.schema';
import { responseFormatSchema } from './response-format.schema';

// Recorte y preprocesamiento (diseño §4 S0–S2). Los perfiles se declaran aquí y se
// replican como constante en services/omr (un test compara ambos JSON).
// Nunca binarizar ni "limpiar" trazos: puede borrar un punto decimal.

// Margen (`bleed`) alrededor de la región, en px de la página rectificada:
// - `bleedBasis: 'longer_side'` (v1): `bleedRatio` × lado MAYOR de la región, igual
//   en los cuatro lados. En un campo ancho y bajo el margen alcanzaba a las
//   preguntas vecinas y los lectores las transcribían (fotos reales, P8 y P9).
// - `bleedBasis: 'shorter_side'` (v2): `bleedRatio` × lado MENOR de la región.
// - `neighborGapFraction` (null = sin tope): en cada lado, el margen no pasa de esa
//   fracción de la distancia al campo vecino más cercano de ese lado (ver
//   `cropBleedBox`, la referencia que replica services/omr/app/crop.py).
export const CROP_BLEED_BASES = ['longer_side', 'shorter_side'] as const;
export type CropBleedBasis = (typeof CROP_BLEED_BASES)[number];

export const cropProfileSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    bleedRatio: z.number().min(0).max(0.5),
    bleedBasis: z.enum(CROP_BLEED_BASES),
    neighborGapFraction: z.number().min(0).max(1).nullable(),
    targetWidthPx: z.number().int().min(200).max(2000),
    jpegQuality: z.number().int().min(50).max(100),
    contrast: z.enum(['none', 'clahe']),
  })
  .strict();
export type CropProfile = z.infer<typeof cropProfileSchema>;

export const CROP_PROFILES = {
  'short-answer@1': {
    id: 'short-answer',
    version: 1,
    bleedRatio: 0.15,
    bleedBasis: 'longer_side',
    neighborGapFraction: null,
    targetWidthPx: 1000,
    jpegQuality: 85,
    contrast: 'none',
  },
  'free-text@1': {
    id: 'free-text',
    version: 1,
    bleedRatio: 0.05,
    bleedBasis: 'longer_side',
    neighborGapFraction: null,
    targetWidthPx: 1400,
    jpegQuality: 85,
    contrast: 'none',
  },
  'short-answer@2': {
    id: 'short-answer',
    version: 2,
    bleedRatio: 0.3,
    bleedBasis: 'shorter_side',
    neighborGapFraction: 0.5,
    targetWidthPx: 1000,
    jpegQuality: 85,
    contrast: 'none',
  },
  'free-text@2': {
    id: 'free-text',
    version: 2,
    bleedRatio: 0.1,
    bleedBasis: 'shorter_side',
    neighborGapFraction: 0.5,
    targetWidthPx: 1400,
    jpegQuality: 85,
    contrast: 'none',
  },
} as const satisfies Record<string, CropProfile>;
export type CropProfileRef = keyof typeof CROP_PROFILES;

export interface CropBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function regionBox(region: OmrRegion, frame: { width: number; height: number }): CropBox {
  const xs = [region.topLeft.x * frame.width, region.bottomRight.x * frame.width];
  const ys = [region.topLeft.y * frame.height, region.bottomRight.y * frame.height];
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

function sideCap(gaps: readonly number[], fraction: number | null, pad: number): number {
  if (fraction === null) return pad;
  const nearest = Math.min(...gaps.filter((gap) => gap >= 0));
  return Number.isFinite(nearest) ? Math.min(pad, fraction * nearest) : pad;
}

/**
 * Caja recortada (en las unidades de `frame`, sin acotar a la página) de una región
 * con su perfil. `neighbors` son las huellas de los OTROS campos de la misma página
 * (su `region`, o la caja de sus burbujas). Un vecino limita el lado hacia el que
 * está solo si se superpone con la región en el eje perpendicular; un vecino que
 * se superpone con la región misma no limita nada.
 */
export function cropBleedBox(
  region: CropBox,
  profile: CropProfile,
  neighbors: readonly CropBox[],
): CropBox {
  const width = region.x1 - region.x0;
  const height = region.y1 - region.y0;
  const side =
    profile.bleedBasis === 'longer_side' ? Math.max(width, height) : Math.min(width, height);
  const pad = profile.bleedRatio * side;
  const fraction = profile.neighborGapFraction;
  const inRow = neighbors.filter((n) => overlaps(n.y0, n.y1, region.y0, region.y1));
  const inColumn = neighbors.filter((n) => overlaps(n.x0, n.x1, region.x0, region.x1));
  return {
    x0:
      region.x0 -
      sideCap(
        inRow.map((n) => region.x0 - n.x1),
        fraction,
        pad,
      ),
    x1:
      region.x1 +
      sideCap(
        inRow.map((n) => n.x0 - region.x1),
        fraction,
        pad,
      ),
    y0:
      region.y0 -
      sideCap(
        inColumn.map((n) => region.y0 - n.y1),
        fraction,
        pad,
      ),
    y1:
      region.y1 +
      sideCap(
        inColumn.map((n) => n.y0 - region.y1),
        fraction,
        pad,
      ),
  };
}

// Evidencia del recorte que devuelve el motor OMR (contrato v2, opcional).
// `inkRatio` se mide DESPUÉS de restar la plantilla impresa de las casillas.
export const cropEvidenceSchema = z.object({
  cropProfileId: z.string().min(1),
  inkRatio: z.number().min(0).max(1),
  inkRatioByPart: z.record(z.string(), z.number().min(0).max(1)).optional(),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  sha256: z.string().length(64),
});
export type CropEvidence = z.infer<typeof cropEvidenceSchema>;

// Extensión opcional de un campo del LayoutSpec con la geometría de casillas
// del formato. Se conecta a `omrFieldSchema` en F5b (campo opcional: el
// layoutHash omite claves undefined, así que las hojas ya impresas no cambian).
export const OMR_RESPONSE_BOX_ROLES = [
  'char',
  'sign',
  'decimal_separator',
  'numerator',
  'denominator',
  'whole',
  'tuple_component',
  'sequence_element',
  'word',
  'line',
  'area',
] as const;

export const omrResponseBoxSchema = z
  .object({
    partId: z.string().min(1),
    region: omrRegionSchema,
    role: z.enum(OMR_RESPONSE_BOX_ROLES),
  })
  .strict();
export type OmrResponseBox = z.infer<typeof omrResponseBoxSchema>;

export const omrFieldResponseSchema = z
  .object({
    itemId: z.string().uuid(),
    format: responseFormatSchema,
    boxes: z.array(omrResponseBoxSchema),
    cropProfileId: z.string().min(1),
  })
  .strict();
export type OmrFieldResponse = z.infer<typeof omrFieldResponseSchema>;
