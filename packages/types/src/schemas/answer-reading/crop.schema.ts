import { z } from 'zod';
import { omrRegionSchema } from '../omr-geometry.schema';
import { responseFormatSchema } from './response-format.schema';

// Recorte y preprocesamiento (diseño §4 S0–S2). Los perfiles se declaran aquí y se
// replican como constante en services/omr (un test compara ambos JSON).
// Nunca binarizar ni "limpiar" trazos: puede borrar un punto decimal.

export const cropProfileSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    bleedRatio: z.number().min(0).max(0.5),
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
    targetWidthPx: 1000,
    jpegQuality: 85,
    contrast: 'none',
  },
  'free-text@1': {
    id: 'free-text',
    version: 1,
    bleedRatio: 0.05,
    targetWidthPx: 1400,
    jpegQuality: 85,
    contrast: 'none',
  },
} as const satisfies Record<string, CropProfile>;
export type CropProfileRef = keyof typeof CROP_PROFILES;

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
