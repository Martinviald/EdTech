import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SHEET_MANAGEMENT_ROLES } from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { getEffectiveOrgId } from '../common/helpers/org-context.helper';
import {
  SheetScanMetricsService,
  type SheetScanMetricsResponse,
} from './sheet-scan-metrics.service';

@Controller('sheet-scan-metrics')
@UseGuards(RolesGuard)
export class SheetScanMetricsController {
  constructor(private readonly sheetScanMetricsService: SheetScanMetricsService) {}

  @Get()
  @Roles(...SHEET_MANAGEMENT_ROLES)
  getMetrics(
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<SheetScanMetricsResponse> {
    return this.sheetScanMetricsService.getMetrics(getEffectiveOrgId(user, orgId));
  }
}
