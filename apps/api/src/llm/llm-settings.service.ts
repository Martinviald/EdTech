import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { llmSettings } from '@soe/db';
import {
  LLM_FEATURE_DEFAULTS,
  LLM_FEATURE_LABELS,
  LLM_FEATURES,
  LLM_PROVIDER_LABELS,
  LLM_PROVIDERS,
  MULTIMODAL_FEATURES,
  STRUCTURED_OUTPUT_FEATURES,
  type LlmFeature,
  type LlmFeatureConfig,
  type LlmSettingsResponse,
  type UpdateLlmSettingDto,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import { LlmModelsService } from './llm-models.service';
import { LLM_PROVIDERS as LLM_PROVIDER_REGISTRY } from './llm.constants';
import type { LlmProvider } from './llm.types';

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
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly models: LlmModelsService,
    @Inject(LLM_PROVIDER_REGISTRY) private readonly registry: LlmProvider[],
  ) {}

  /**
   * Config efectiva de cada funcionalidad + modelos habilitados (`llm_models`) para el panel.
   * Para cada feature: fila global si existe (`source: 'global'`), si no el default
   * de código (`source: 'default'`).
   */
  async getSettings(): Promise<LlmSettingsResponse> {
    const [globals, catalog] = await Promise.all([
      this.db
        .select({
          feature: llmSettings.feature,
          provider: llmSettings.provider,
          model: llmSettings.model,
        })
        .from(llmSettings)
        .where(isNull(llmSettings.orgId)),
      this.models.listEnabledByProvider(),
    ]);

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
      providers: this.providerOptions(),
      catalog,
    };
  }

  /**
   * Upsert de la fila GLOBAL de una funcionalidad. `dto` trae sólo la forma validada
   * por Zod; aquí se valida contra `llm_models` que el modelo exista, esté habilitado
   * y sea multimodal cuando la funcionalidad envía imágenes.
   */
  async upsertGlobal(
    feature: LlmFeature,
    dto: UpdateLlmSettingDto,
  ): Promise<LlmSettingsResponse> {
    const model = await this.models.findSelectableModel(dto.provider, dto.model);
    if (!model) {
      throw new BadRequestException('Modelo no disponible para el proveedor seleccionado');
    }
    if (MULTIMODAL_FEATURES.includes(feature) && !model.supportsImages) {
      throw new BadRequestException(
        `La funcionalidad "${feature}" envía imágenes al modelo y requiere un modelo multimodal`,
      );
    }
    if (STRUCTURED_OUTPUT_FEATURES.includes(feature) && !model.supportsStructuredOutput) {
      throw new BadRequestException(
        `La funcionalidad "${feature}" requiere un modelo con salida estructurada`,
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

  private providerOptions(): LlmSettingsResponse['providers'] {
    const available = new Set<string>(
      this.registry.filter((provider) => provider.isAvailable()).map((provider) => provider.name),
    );
    return LLM_PROVIDERS.map((id) => ({
      id,
      label: LLM_PROVIDER_LABELS[id],
      available: available.has(id),
    }));
  }
}
