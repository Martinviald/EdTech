import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import {
  PERFORMANCE_BANDS_ADMIN_ROLES,
  performanceBandListQuerySchema,
  upsertInstrumentBandsSchema,
  type PerformanceBandListResponse,
} from '@soe/types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { PerformanceBandsService } from './performance-bands.service';

/**
 * Gestión de niveles/umbrales de logro por instrumento (performance_bands).
 * Config GLOBAL (compartida por todas las orgs que usan el instrumento) → sólo
 * `platform_admin` (`PERFORMANCE_BANDS_ADMIN_ROLES`). En runtime el scoring la
 * consume vía `loadInstrumentBands`.
 */
@Controller()
@UseGuards(RolesGuard)
@Roles(...PERFORMANCE_BANDS_ADMIN_ROLES)
export class PerformanceBandsController {
  constructor(private readonly service: PerformanceBandsService) {}

  /** GET /api/performance-bands?instrumentId= — set de bandas globales del instrumento. */
  @Get('performance-bands')
  list(@Query() query: unknown): Promise<PerformanceBandListResponse> {
    const { instrumentId } = performanceBandListQuerySchema.parse(query);
    return this.service.listByInstrument(instrumentId);
  }

  /** PUT /api/instruments/:instrumentId/performance-bands — reemplaza el set completo. */
  @Put('instruments/:instrumentId/performance-bands')
  upsert(
    @Param('instrumentId') instrumentId: string,
    @Body() body: unknown,
  ): Promise<PerformanceBandListResponse> {
    const dto = upsertInstrumentBandsSchema.parse(body);
    return this.service.upsertInstrumentBands(instrumentId, dto);
  }
}
