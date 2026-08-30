import { z } from 'zod';

// ── Lector de marcas (E22) — LayoutSpec, el contrato central ─────────────────
// Una sola pieza de datos compartida por TRES consumidores que se escriben por
// separado: el diseñador (la produce), el impresor (dibuja el PDF) y el lector
// (busca las burbujas). Si alguno duplica coordenadas, el sistema falla de un
// modo imposible de atribuir. Ver docs/diseno-lector-de-marcas/03-contratos.md §3.1.
//
// Sistema de coordenadas: TODAS las coordenadas son fracciones 0–1 del
// rectángulo definido por los 4 fiduciales de esquina — NUNCA de la página
// (D7: inmune al "ajustar a página" de cualquier impresora).

export const omrPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const omrRegionSchema = z.object({
  topLeft: omrPointSchema,
  bottomRight: omrPointSchema,
});

export const omrBubbleSchema = z.object({
  value: z.string().min(1),
  center: omrPointSchema,
  radius: z.number().positive(),
  group: z.number().int().min(0).nullable().optional(),
});

export const OMR_FIELD_KINDS = ['bubble_group', 'digit_grid', 'crop_region'] as const;
export const omrFieldKindSchema = z.enum(OMR_FIELD_KINDS);
export type OmrFieldKind = (typeof OMR_FIELD_KINDS)[number];

export const omrFieldSchema = z.object({
  fieldId: z.string().min(1),
  kind: omrFieldKindSchema,
  /** Etiqueta IMPRESA que ve el alumno ("1", "12", "19.1") — NUNCA la position del ítem (D17). */
  printedNumber: z.string().min(1),
  pageIndex: z.number().int().min(0),
  selectMode: z.enum(['single', 'multiple']),
  bubbles: z.array(omrBubbleSchema),
  region: omrRegionSchema.nullable(),
});

export const CAPTURE_SOURCES = ['scanner', 'phone'] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

/** Diferencias escáner/celular como DATOS, no subclases (D2). */
export const captureProfileSchema = z.object({
  source: z.enum(CAPTURE_SOURCES),
  normalizeIllumination: z.boolean(),
  minSharpness: z.number().min(0).max(1),
  maxGlare: z.number().min(0).max(1),
  expectedDpi: z.number().int().positive().nullable(),
  ambiguityMargin: z.number().min(0.05).max(0.5).nullable().default(null),
});

export type CaptureProfile = z.infer<typeof captureProfileSchema>;

/** Perfiles por defecto; ajustables por el usuario al crear el lote, calibrables en v1 (D8). */
export const DEFAULT_CAPTURE_PROFILES: Record<CaptureSource, CaptureProfile> = {
  scanner: {
    source: 'scanner',
    normalizeIllumination: false,
    minSharpness: 0.45,
    maxGlare: 0.35,
    expectedDpi: 300,
    ambiguityMargin: null,
  },
  phone: {
    source: 'phone',
    normalizeIllumination: true,
    minSharpness: 0.35,
    maxGlare: 0.25,
    expectedDpi: null,
    ambiguityMargin: null,
  },
};

export const SHEET_IDENTITY_MODES = ['qr', 'rut_bubbles', 'none'] as const;
export type SheetIdentityMode = (typeof SHEET_IDENTITY_MODES)[number];

export const layoutSpecSchema = z.object({
  specVersion: z.literal(1),
  instrumentId: z.string().uuid(),
  pageCount: z.number().int().positive(),
  paper: z.enum(['letter', 'a4', 'legal']),
  fiducials: z.object({
    kind: z.literal('corner_squares'),
    sizeRatio: z.number().positive(),
    marginRatio: z.number().positive(),
  }),
  identity: z.object({
    mode: z.enum(SHEET_IDENTITY_MODES),
    region: omrRegionSchema,
    bubbles: z.array(omrBubbleSchema).nullable().optional(),
  }),
  fields: z.array(omrFieldSchema).min(1),
});

export const omrCalibrationSchema = z.object({
  ambiguityMargin: z.number().min(0.05).max(0.5).optional(),
  minSeparability: z.number().min(0).max(1).optional(),
});

export type OmrCalibration = z.infer<typeof omrCalibrationSchema>;

export type OmrPoint = z.infer<typeof omrPointSchema>;
export type OmrRegion = z.infer<typeof omrRegionSchema>;
export type OmrBubble = z.infer<typeof omrBubbleSchema>;
export type LayoutField = z.infer<typeof omrFieldSchema>;
export type LayoutSpec = z.infer<typeof layoutSpecSchema>;
