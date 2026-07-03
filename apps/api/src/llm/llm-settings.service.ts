import { BadRequestException, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { llmSettings } from '@soe/db';
import {
  findModelOption,
  LLM_FEATURE_DEFAULTS,
  LLM_FEATURE_LABELS,
  LLM_FEATURES,
  LLM_MODEL_CATALOG,
  LLM_PROVIDER_LABELS,
  LLM_PROVIDERS,
  MULTIMODAL_FEATURES,
  type LlmFeature,
  type LlmFeatureConfig,
  type LlmSettingsResponse,
  type UpdateLlmSettingDto,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';

/**
 * Lectura/escritura de la configuración de modelos de IA por funcionalidad
 * (panel /configuracion/modelos-ia). HOY sólo opera sobre la fila GLOBAL
 * (`org_id IS NULL`): la config es igual para todas las orgs. Per-org en el futuro.
 *
 * `LlmConfigService.resolve` es quien consume esta config en runtime; este service
 * es el lado de gestión (panel).
 */
@Injectable()
export class LlmSettingsService {
  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Config efectiva de las 5 funcionalidades + catálogo de modelos para el panel.
   * Para cada feature: fila global si existe (`source: 'global'`), si no el default
   * de código (`source: 'default'`).
   */
  async getSettings(): Promise<LlmSettingsResponse> {
    const globals = await this.db
      .select({
        feature: llmSettings.feature,
        provider: llmSettings.provider,
        model: llmSettings.model,
      })
      .from(llmSettings)
      .where(isNull(llmSettings.orgId));

    const byFeature = new Map(globals.map((r) => [r.feature, r]));

    const features: LlmFeatureConfig[] = LLM_FEATURES.map((feature) => {
      const meta = LLM_FEATURE_LABELS[feature];
      const row = byFeature.get(feature);
      if (row) {
        return {
          feature,
          label: meta.label,
          description: meta.description,
          provider: row.provider,
          model: row.model,
          source: 'global',
        };
      }
      const def = LLM_FEATURE_DEFAULTS[feature];
      return {
        feature,
        label: meta.label,
        description: meta.description,
        provider: def.provider,
        model: def.model,
        source: 'default',
      };
    });

    return {
      features,
      providers: LLM_PROVIDERS.map((id) => ({ id, label: LLM_PROVIDER_LABELS[id] })),
      catalog: LLM_MODEL_CATALOG as LlmSettingsResponse['catalog'],
    };
  }

  /**
   * Upsert de la fila GLOBAL de una funcionalidad. `dto` ya viene validado por Zod
   * (modelo ∈ catálogo del proveedor); aquí se valida la regla extra de multimodal.
   */
  async upsertGlobal(
    feature: LlmFeature,
    dto: UpdateLlmSettingDto,
  ): Promise<LlmSettingsResponse> {
    const option = findModelOption(dto.provider, dto.model);
    if (!option) {
      throw new BadRequestException('Modelo no disponible para el proveedor seleccionado');
    }
    if (MULTIMODAL_FEATURES.includes(feature) && !option.multimodal) {
      throw new BadRequestException(
        `La funcionalidad "${feature}" envía imágenes al modelo y requiere un modelo multimodal`,
      );
    }

    // Upsert manual de la fila global (org_id IS NULL). Se evita ON CONFLICT sobre el
    // índice parcial; la escritura es rara (un admin) y no compite por concurrencia.
    const [existing] = await this.db
      .select({ id: llmSettings.id })
      .from(llmSettings)
      .where(and(eq(llmSettings.feature, feature), isNull(llmSettings.orgId)))
      .limit(1);

    if (existing) {
      await this.db
        .update(llmSettings)
        .set({ provider: dto.provider, model: dto.model, updatedAt: new Date() })
        .where(eq(llmSettings.id, existing.id));
    } else {
      await this.db.insert(llmSettings).values({
        orgId: null,
        feature,
        provider: dto.provider,
        model: dto.model,
      });
    }

    return this.getSettings();
  }
}
