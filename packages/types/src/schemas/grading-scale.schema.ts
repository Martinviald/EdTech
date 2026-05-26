import { z } from 'zod';

/**
 * Tipos de escala de notas soportados. Debe estar sincronizado con
 * `gradingScaleTypeEnum` en `packages/db/src/schema/enums.ts`.
 */
export const GRADING_SCALE_TYPES = [
  'linear_chilean',
  'percentage',
  'paes_scaled',
  'irt_based',
  'custom',
] as const;
export type GradingScaleTypeValue = (typeof GRADING_SCALE_TYPES)[number];

export const gradingScaleTypeSchema = z.enum(GRADING_SCALE_TYPES);

/**
 * Reglas comunes para creación y actualización:
 * - minGrade < passingGrade < maxGrade
 * - 0 < passingThreshold < 1 (porcentaje de exigencia)
 */
const baseFieldsSchema = z.object({
  name: z.string().min(2).max(200),
  type: gradingScaleTypeSchema,
  minGrade: z.number().finite(),
  maxGrade: z.number().finite(),
  passingGrade: z.number().finite(),
  passingThreshold: z.number().gt(0).lt(1),
  config: z.record(z.unknown()).optional(),
});

export const gradingScaleCreateSchema = baseFieldsSchema.superRefine((data, ctx) => {
  if (!(data.minGrade < data.passingGrade)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['passingGrade'],
      message: 'passingGrade debe ser mayor que minGrade',
    });
  }
  if (!(data.passingGrade < data.maxGrade)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxGrade'],
      message: 'maxGrade debe ser mayor que passingGrade',
    });
  }
});

export const gradingScaleUpdateSchema = baseFieldsSchema.partial().superRefine((data, ctx) => {
  if (
    data.minGrade !== undefined &&
    data.passingGrade !== undefined &&
    !(data.minGrade < data.passingGrade)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['passingGrade'],
      message: 'passingGrade debe ser mayor que minGrade',
    });
  }
  if (
    data.passingGrade !== undefined &&
    data.maxGrade !== undefined &&
    !(data.passingGrade < data.maxGrade)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxGrade'],
      message: 'maxGrade debe ser mayor que passingGrade',
    });
  }
});

export const gradingScaleListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: gradingScaleTypeSchema.optional(),
  isGlobal: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
});

export const gradingScalePreviewRequestSchema = z.object({
  percentages: z.array(z.number().min(0).max(1)).min(1).max(200),
});

export type GradingScaleCreateDto = z.infer<typeof gradingScaleCreateSchema>;
export type GradingScaleUpdateDto = z.infer<typeof gradingScaleUpdateSchema>;
export type GradingScaleListQueryDto = z.infer<typeof gradingScaleListQuerySchema>;
export type GradingScalePreviewRequestDto = z.infer<typeof gradingScalePreviewRequestSchema>;

/**
 * Representación de una escala en respuestas HTTP. `isGlobal` se deriva al
 * leer (`orgId === null`); nunca se persiste — los inserts y updates al DB
 * NO deben incluir este campo.
 */
export interface GradingScaleResponseModel {
  id: string;
  orgId: string | null;
  isGlobal: boolean;
  name: string;
  type: GradingScaleTypeValue;
  minGrade: number;
  maxGrade: number;
  passingGrade: number;
  passingThreshold: number;
  config: Record<string, unknown>;
  createdAt: string;
}

export interface GradingScaleListResponse {
  data: GradingScaleResponseModel[];
  total: number;
  page: number;
  limit: number;
}

export interface GradingScalePreviewRow {
  percentage: number;
  grade: number;
  isPassing: boolean;
}

export interface GradingScalePreviewResponse {
  scaleId: string;
  rows: GradingScalePreviewRow[];
}
