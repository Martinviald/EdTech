import { z } from 'zod';

// Geometría base del LayoutSpec: fracciones 0–1 del rectángulo de los fiduciales.
// Vive aparte de omr-layout.schema.ts para que los contratos de answer-reading
// (crop.schema.ts) la usen sin crear un ciclo de imports con el LayoutSpec.

export const omrPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const omrRegionSchema = z.object({
  topLeft: omrPointSchema,
  bottomRight: omrPointSchema,
});

export type OmrPoint = z.infer<typeof omrPointSchema>;
export type OmrRegion = z.infer<typeof omrRegionSchema>;
