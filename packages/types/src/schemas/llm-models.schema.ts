import { z } from 'zod';
import { llmProviderSchema } from './llm-settings.schema';

/**
 * Catálogo global de modelos de IA (tabla `llm_models`). Lo administra
 * `platform_admin` vía /api/llm-models; no contiene datos de colegios. Los precios
 * son USD por millón de tokens y alimentan la estimación de costo de cada llamada.
 */

const MAX_USD_PER_MTOK = 1000;

const usdPerMtokSchema = z.number().finite().min(0).max(MAX_USD_PER_MTOK);

const modelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, 'Identificador de modelo inválido');

const maxOutputTokensSchema = z.number().int().min(1).max(1_000_000);

const batchDiscountSchema = z.number().finite().min(0).max(1);

/** Un modelo del catálogo (respuesta de la API de administración). */
export const llmModelSchema = z.object({
  id: z.string().uuid(),
  provider: llmProviderSchema,
  modelId: z.string(),
  label: z.string(),
  maxOutputTokens: z.number().int().positive(),
  supportsImages: z.boolean(),
  supportsStructuredOutput: z.boolean(),
  supportsBatch: z.boolean(),
  supportsSamplingParams: z.boolean(),
  inputUsdPerMtok: z.number(),
  outputUsdPerMtok: z.number(),
  cachedInputUsdPerMtok: z.number().nullable(),
  batchDiscount: z.number().nullable(),
  enabled: z.boolean(),
  deprecatedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LlmModel = z.infer<typeof llmModelSchema>;

/** GET /api/llm-models — catálogo completo (habilitados y deshabilitados). */
export const llmModelListResponseSchema = z.object({
  data: z.array(llmModelSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().nonnegative(),
});
export type LlmModelListResponse = z.infer<typeof llmModelListResponseSchema>;

/** POST /api/llm-models — alta de un modelo en el catálogo. */
export const createLlmModelSchema = z
  .object({
    provider: llmProviderSchema,
    modelId: modelIdSchema,
    label: z.string().trim().min(1).max(120),
    maxOutputTokens: maxOutputTokensSchema,
    supportsImages: z.boolean().default(false),
    supportsStructuredOutput: z.boolean().default(false),
    supportsBatch: z.boolean().default(false),
    supportsSamplingParams: z.boolean().default(true),
    inputUsdPerMtok: usdPerMtokSchema,
    outputUsdPerMtok: usdPerMtokSchema,
    cachedInputUsdPerMtok: usdPerMtokSchema.nullable().default(null),
    batchDiscount: batchDiscountSchema.nullable().default(null),
    enabled: z.boolean().default(true),
  })
  .strict();
export type CreateLlmModelDto = z.infer<typeof createLlmModelSchema>;

/**
 * PATCH /api/llm-models/:id — edición de precios, capacidades, habilitado o
 * deprecado. `provider` y `modelId` no se editan (identifican la fila). `deprecated`
 * fija `deprecated_at` en el momento de la edición (`true`) o lo limpia (`false`).
 */
export const updateLlmModelSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    maxOutputTokens: maxOutputTokensSchema,
    supportsImages: z.boolean(),
    supportsStructuredOutput: z.boolean(),
    supportsBatch: z.boolean(),
    supportsSamplingParams: z.boolean(),
    inputUsdPerMtok: usdPerMtokSchema,
    outputUsdPerMtok: usdPerMtokSchema,
    cachedInputUsdPerMtok: usdPerMtokSchema.nullable(),
    batchDiscount: batchDiscountSchema.nullable(),
    enabled: z.boolean(),
    deprecated: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Debes indicar al menos un campo a modificar',
  });
export type UpdateLlmModelDto = z.infer<typeof updateLlmModelSchema>;
