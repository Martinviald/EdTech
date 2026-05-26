import { z } from 'zod';

export const GRADING_SCALE_TYPES = [
  'linear_chilean',
  'percentage',
  'paes_scaled',
  'irt_based',
  'custom',
] as const;
export type GradingScaleType = (typeof GRADING_SCALE_TYPES)[number];

/**
 * Parámetros mínimos que necesita el calculador puro para convertir un
 * porcentaje en nota y en nivel de logro. Se construye a partir de un
 * registro `grading_scales` de la BD o desde un fallback hardcoded.
 */
export const gradingScaleParamsSchema = z.object({
  type: z.enum(GRADING_SCALE_TYPES),
  minGrade: z.number(),
  maxGrade: z.number(),
  passingGrade: z.number(),
  passingThreshold: z.number().min(0).max(1),
  /**
   * Thresholds opcionales para `performance_level`. Si no se proveen, se
   * usan defaults (ver `percentageToPerformanceLevel`).
   */
  performanceThresholds: z
    .object({
      insufficient: z.number().min(0).max(1).optional(),
      elementary: z.number().min(0).max(1).optional(),
      adequate: z.number().min(0).max(1).optional(),
      advanced: z.number().min(0).max(1).optional(),
    })
    .optional(),
});
export type GradingScaleParams = z.infer<typeof gradingScaleParamsSchema>;

/**
 * Una respuesta normalizada lista para alimentar al calculador puro. Sin
 * dependencia de Drizzle ni del schema de BD.
 */
export const responseForCalculationSchema = z.object({
  studentId: z.string().uuid(),
  itemId: z.string().uuid(),
  rawScore: z.number(),
  maxScore: z.number(),
  finalScore: z.number().nullable(),
  isCorrect: z.boolean().nullable(),
  /** Nodos taxonómicos asociados al ítem para agregar `skill_results`. */
  taxonomyNodeIds: z.array(z.string().uuid()),
});
export type ResponseForCalculation = z.infer<typeof responseForCalculationSchema>;

/** Default global que el sistema usa cuando un instrumento no tiene escala asignada. */
export const DEFAULT_GRADING_SCALE: GradingScaleParams = {
  type: 'linear_chilean',
  minGrade: 1,
  maxGrade: 7,
  passingGrade: 4,
  passingThreshold: 0.6,
};
