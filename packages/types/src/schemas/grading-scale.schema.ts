import { z } from 'zod';

/**
 * Tipos de escalas de notas soportadas. Espejo del enum `grading_scale_type`
 * en packages/db/src/schema/enums.ts.
 */
export const GRADING_SCALE_TYPE_VALUES = [
  'linear_chilean',
  'percentage',
  'paes_scaled',
  'irt_based',
  'custom',
] as const;
export const gradingScaleTypeSchema = z.enum(GRADING_SCALE_TYPE_VALUES);
export type GradingScaleTypeValue = z.infer<typeof gradingScaleTypeSchema>;

// ── Models de respuesta (camelCase). Los campos numéricos (minGrade, etc.) ───
// vienen como string porque Drizzle mapea las columnas `decimal` de Postgres
// a string para preservar precisión exacta.
export const gradingScaleResponseSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid().nullable(),
  name: z.string(),
  type: gradingScaleTypeSchema,
  minGrade: z.string(),
  maxGrade: z.string(),
  passingGrade: z.string(),
  passingThreshold: z.string(),
  config: z.record(z.unknown()).nullable(),
  isGlobal: z.boolean(),
  createdAt: z.string().datetime(),
});
export type GradingScaleResponseModel = z.infer<typeof gradingScaleResponseSchema>;

export const gradingScaleListResponseSchema = z.object({
  data: z.array(gradingScaleResponseSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
});
export type GradingScaleListResponse = z.infer<typeof gradingScaleListResponseSchema>;

// ── DTOs de mutación ─────────────────────────────────────────────────────────

const gradeNumberSchema = z.coerce.number().finite();
const thresholdSchema = z.coerce.number().gt(0).lt(1);

export const gradingScaleCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: gradingScaleTypeSchema,
    minGrade: gradeNumberSchema,
    maxGrade: gradeNumberSchema,
    passingGrade: gradeNumberSchema,
    passingThreshold: thresholdSchema,
    config: z.record(z.unknown()).optional(),
    /** Solo válido cuando el caller es platform_admin. */
    isGlobal: z.boolean().optional(),
  })
  .refine((data) => data.minGrade < data.passingGrade, {
    message: 'minGrade debe ser menor que passingGrade',
    path: ['passingGrade'],
  })
  .refine((data) => data.passingGrade < data.maxGrade, {
    message: 'passingGrade debe ser menor que maxGrade',
    path: ['passingGrade'],
  });
export type GradingScaleCreateDto = z.infer<typeof gradingScaleCreateSchema>;

export const gradingScaleUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    type: gradingScaleTypeSchema.optional(),
    minGrade: gradeNumberSchema.optional(),
    maxGrade: gradeNumberSchema.optional(),
    passingGrade: gradeNumberSchema.optional(),
    passingThreshold: thresholdSchema.optional(),
    config: z.record(z.unknown()).optional(),
  })
  .refine(
    (data) => {
      if (data.minGrade !== undefined && data.passingGrade !== undefined) {
        return data.minGrade < data.passingGrade;
      }
      return true;
    },
    { message: 'minGrade debe ser menor que passingGrade', path: ['passingGrade'] },
  )
  .refine(
    (data) => {
      if (data.passingGrade !== undefined && data.maxGrade !== undefined) {
        return data.passingGrade < data.maxGrade;
      }
      return true;
    },
    { message: 'passingGrade debe ser menor que maxGrade', path: ['passingGrade'] },
  );
export type GradingScaleUpdateDto = z.infer<typeof gradingScaleUpdateSchema>;

// ── Preview de conversión ────────────────────────────────────────────────────

export const gradingScalePreviewRequestSchema = z.object({
  percentages: z.array(z.coerce.number().min(0).max(100)).min(1).max(50),
});
export type GradingScalePreviewRequestDto = z.infer<typeof gradingScalePreviewRequestSchema>;

export const gradingScalePreviewItemSchema = z.object({
  percentage: z.number(),
  grade: z.number(),
  passed: z.boolean(),
});
export type GradingScalePreviewItem = z.infer<typeof gradingScalePreviewItemSchema>;

export const gradingScalePreviewResponseSchema = z.object({
  scaleId: z.string().uuid(),
  results: z.array(gradingScalePreviewItemSchema),
});
export type GradingScalePreviewResponse = z.infer<typeof gradingScalePreviewResponseSchema>;
