import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import {
  LLM_SETTINGS_ROLES,
  llmFeatureSchema,
  updateLlmSettingSchema,
  type LlmSettingsResponse,
} from '@soe/types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { LlmSettingsService } from './llm-settings.service';

/**
 * Gestión de la configuración de modelos de IA por funcionalidad
 * (panel /configuracion/modelos-ia). Config GLOBAL (todas las orgs) → sólo
 * `platform_admin` (`LLM_SETTINGS_ROLES`). En runtime la consume `LlmConfigService`.
 */
@Controller('llm-settings')
@UseGuards(RolesGuard)
@Roles(...LLM_SETTINGS_ROLES)
export class LlmSettingsController {
  constructor(private readonly settings: LlmSettingsService) {}

  /** GET /api/llm-settings — config efectiva de cada funcionalidad + catálogo. */
  @Get()
  getSettings(): Promise<LlmSettingsResponse> {
    return this.settings.getSettings();
  }

  /** PATCH /api/llm-settings/:feature — fija proveedor+modelo global de una funcionalidad. */
  @Patch(':feature')
  updateFeature(
    @Param('feature') feature: string,
    @Body() body: unknown,
  ): Promise<LlmSettingsResponse> {
    const parsedFeature = llmFeatureSchema.parse(feature);
    const dto = updateLlmSettingSchema.parse(body);
    return this.settings.upsertGlobal(parsedFeature, dto);
  }
}
