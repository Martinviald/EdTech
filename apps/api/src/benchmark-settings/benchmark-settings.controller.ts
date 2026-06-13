import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { BENCHMARK_SETTINGS_ROLES, updateBenchmarkSettingsSchema } from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { BenchmarkSettingsService } from './benchmark-settings.service';

/**
 * H19.24 — Participación en benchmarking. Opera SIEMPRE sobre la org del token
 * (`user.orgId`), nunca recibe orgId del body/query.
 */
@Controller('benchmark-settings')
@UseGuards(RolesGuard)
export class BenchmarkSettingsController {
  constructor(private readonly service: BenchmarkSettingsService) {}

  /**
   * GET /api/benchmark-settings
   * Devuelve la configuración de benchmarking de la org (creándola con defaults
   * si no existe), con `networkOrgId` derivado de `organizations.parent_id`.
   */
  @Get()
  @Roles(...BENCHMARK_SETTINGS_ROLES)
  get(@CurrentUser() user: JwtPayload) {
    return this.service.getForOrg(user);
  }

  /**
   * PATCH /api/benchmark-settings
   * Actualiza el opt-out del pool global. Sella el consentimiento la primera vez.
   */
  @Patch()
  @Roles(...BENCHMARK_SETTINGS_ROLES)
  update(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = updateBenchmarkSettingsSchema.parse(body ?? {});
    return this.service.update(user, dto);
  }
}
