import { Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { llmSettings } from '@soe/db';
import {
  LLM_FALLBACK_MAX_TOKENS,
  LLM_FEATURE_DEFAULTS,
  type LlmFeature,
  type LlmModel,
  type LlmModelChoice,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import { LlmModelsService } from './llm-models.service';
import { ACTIVE_LLM_PROVIDER, LLM_PROVIDER_DEFAULTS } from './llm.constants';
import type { LlmRuntimeConfig } from './llm.types';

/**
 * Resuelve la configuración LLM efectiva (proveedor + modelo + parámetros) POR
 * FUNCIONALIDAD (`LlmFeature`).
 *
 * Fuente de verdad en runtime: tabla `llm_settings` (panel /configuracion/modelos-ia).
 *  1. Fila per-org (`org_id = :orgId`) si existe → gana. (Hoy no se escriben filas
 *     per-org; quedan habilitadas para el futuro. Nota RLS: las filas per-org sólo
 *     son visibles dentro de `withOrgContext`; las globales se leen sin contexto.)
 *  2. Fila global (`org_id IS NULL`).
 *  3. Default de código `LLM_FEATURE_DEFAULTS[feature]` (fallback).
 * El `maxTokens` se deriva del catálogo `llm_models` (`LlmModelsService`); el
 * panel sólo configura proveedor + modelo.
 */
@Injectable()
export class LlmConfigService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly models: LlmModelsService,
  ) {}

  async resolve(
    orgId: string | null | undefined,
    feature: LlmFeature,
  ): Promise<LlmRuntimeConfig> {
    const choice = await this.resolveChoice(orgId, feature);
    return this.forChoice(choice);
  }

  async forChoice(choice: LlmModelChoice): Promise<LlmRuntimeConfig> {
    const model = await this.models.findModel(choice.provider, choice.model);
    return this.toRuntimeConfig(choice, model);
  }

  private toRuntimeConfig(choice: LlmModelChoice, model: LlmModel | undefined): LlmRuntimeConfig {
    const { temperature } = LLM_PROVIDER_DEFAULTS[choice.provider];
    const sendsTemperature = temperature !== undefined && (model?.supportsSamplingParams ?? true);
    return {
      provider: choice.provider,
      model: choice.model,
      maxTokens: model?.maxOutputTokens ?? LLM_FALLBACK_MAX_TOKENS,
      ...(sendsTemperature ? { temperature } : {}),
    };
  }

  /** Lee `llm_settings` (per-org → global) y cae al default de código. */
  private async resolveChoice(
    orgId: string | null | undefined,
    feature: LlmFeature,
  ): Promise<LlmModelChoice> {
    const rows = await this.db
      .select({
        provider: llmSettings.provider,
        model: llmSettings.model,
        orgId: llmSettings.orgId,
      })
      .from(llmSettings)
      .where(
        and(
          eq(llmSettings.feature, feature),
          orgId
            ? or(isNull(llmSettings.orgId), eq(llmSettings.orgId, orgId))
            : isNull(llmSettings.orgId),
        ),
      )
      // org_id NOT NULL (per-org) primero; global (NULL) al final → per-org gana.
      .orderBy(sql`${llmSettings.orgId} NULLS LAST`)
      .limit(1);

    const row = rows[0];
    if (row) {
      return { provider: row.provider, model: row.model };
    }
    return LLM_FEATURE_DEFAULTS[feature];
  }

  /** Proveedor activo por defecto (para chequeos de disponibilidad/baseline). */
  get activeProvider() {
    return ACTIVE_LLM_PROVIDER;
  }
}
