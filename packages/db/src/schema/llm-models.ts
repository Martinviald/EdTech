import {
  boolean,
  decimal,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { LlmProviderId } from '@soe/types';

/**
 * Catálogo GLOBAL de modelos de IA y sus precios (USD por millón de tokens).
 *
 * Es un catálogo de plataforma sin datos de colegios: no lleva `org_id` ni RLS.
 * Sólo `platform_admin` lo escribe (vía /api/llm-models). `LlmModelsService` lo
 * lee con caché en memoria para validar la configuración de `llm_settings`,
 * derivar el tope de tokens de salida y estimar el costo de cada llamada.
 * Agregar un modelo nuevo (de cualquier proveedor) es insertar una fila.
 */
export const llmModels = pgTable(
  'llm_models',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: text('provider').$type<LlmProviderId>().notNull(),
    modelId: text('model_id').notNull(),
    label: text('label').notNull(),
    maxOutputTokens: integer('max_output_tokens').notNull(),
    supportsImages: boolean('supports_images').default(false).notNull(),
    supportsStructuredOutput: boolean('supports_structured_output').default(false).notNull(),
    supportsBatch: boolean('supports_batch').default(false).notNull(),
    supportsSamplingParams: boolean('supports_sampling_params').default(true).notNull(),
    inputUsdPerMtok: decimal('input_usd_per_mtok', { precision: 12, scale: 6 }).notNull(),
    outputUsdPerMtok: decimal('output_usd_per_mtok', { precision: 12, scale: 6 }).notNull(),
    cachedInputUsdPerMtok: decimal('cached_input_usd_per_mtok', { precision: 12, scale: 6 }),
    /** Fracción de descuento en batch (0–1). `0.5` = el batch cuesta la mitad. */
    batchDiscount: decimal('batch_discount', { precision: 4, scale: 3 }),
    enabled: boolean('enabled').default(true).notNull(),
    deprecatedAt: timestamp('deprecated_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('llm_models_provider_model_uniq').on(table.provider, table.modelId)],
);

export type LlmModelRow = typeof llmModels.$inferSelect;
export type NewLlmModelRow = typeof llmModels.$inferInsert;
