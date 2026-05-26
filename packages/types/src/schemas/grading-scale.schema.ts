import { z } from 'zod';

// Tipos de escala de notas que soportamos. Coincide con `grading_scale_type` enum.
export const GRADING_SCALE_TYPE_VALUES = [
  'linear_chilean',
  'percentage',
  'paes_scaled',
  'irt_based',
  'custom',
] as const;
export type GradingScaleTypeValue = (typeof GRADING_SCALE_TYPE_VALUES)[number];

// ── DTOs ─────────────────────────────────────────────────────────────────────

export const gradingScaleCreateSchema = z.object({
  name: z.string().min(2).max(200),
  type: z.enum(GRADING_SCALE_TYPE_VALUES).default('linear_chilean'),
  minGrade: z.coerce.number().min(0).max(100).default(1),
  maxGrade: z.coerce.number().min(1).max(100).default(7),
  passingGrade: z.coerce.number().min(0).max(100).default(4),
  // Exigencia: porcentaje (0-1) que define la nota de aprobación.
  passingThreshold: z.coerce.number().min(0).max(1).default(0.6),
  // Para escalas custom, parámetros adicionales (curve, brackets, etc.).
  config: z.record(z.unknown()).optional(),
});

export const gradingScaleUpdateSchema = gradingScaleCreateSchema.partial();

export type GradingScaleCreateDto = z.infer<typeof gradingScaleCreateSchema>;
export type GradingScaleUpdateDto = z.infer<typeof gradingScaleUpdateSchema>;

// ── Conversion Preview ───────────────────────────────────────────────────────
// `POST /grading-scales/:id/preview` con un set de porcentajes devuelve las notas resultantes.

export const gradingScalePreviewRequestSchema = z.object({
  // Lista de porcentajes (0..1) a convertir.
  percentages: z.array(z.coerce.number().min(0).max(1)).min(1).max(50),
});
export type GradingScalePreviewRequestDto = z.infer<typeof gradingScalePreviewRequestSchema>;

// ── Response Models ──────────────────────────────────────────────────────────

export type GradingScaleResponseModel = {
  id: string;
  orgId: string | null;
  name: string;
  type: GradingScaleTypeValue;
  minGrade: string;
  maxGrade: string;
  passingGrade: string;
  passingThreshold: string;
  config: Record<string, unknown> | null;
  createdAt: string | Date;
  // Es escala global (orgId null) o de la org del usuario.
  isGlobal: boolean;
};

export type GradingScaleListResponse = {
  data: GradingScaleResponseModel[];
  total: number;
  page: number;
  limit: number;
};

export type GradingScalePreviewResponse = {
  scaleId: string;
  rows: Array<{
    percentage: number; // 0..1
    grade: number; // valor numérico de la nota
    isPassing: boolean;
  }>;
};
