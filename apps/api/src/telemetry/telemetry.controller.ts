import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ingestTelemetrySchema,
  telemetryUsageFiltersSchema,
  telemetryUsageQuerySchema,
  TELEMETRY_VIEWER_ROLES,
  type IngestTelemetryResponse,
  type TelemetryOrgUsageResponse,
  type TelemetryPlatformOverviewResponse,
  type TelemetryUsageResponse,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { TelemetryService } from './telemetry.service';
import { TelemetryUsageService } from './telemetry-usage.service';
import { TelemetryReportService } from './telemetry-report.service';

@Controller('telemetry')
@UseGuards(RolesGuard)
export class TelemetryController {
  constructor(
    private readonly telemetry: TelemetryService,
    private readonly usage: TelemetryUsageService,
    private readonly report: TelemetryReportService,
  ) {}

  @Post('events')
  @HttpCode(202)
  ingest(@Body() body: unknown, @CurrentUser() user: JwtPayload): IngestTelemetryResponse {
    const dto = ingestTelemetrySchema.parse(body);
    return this.telemetry.ingestFromClient(user, dto);
  }

  @Get('usage')
  @Roles(...TELEMETRY_VIEWER_ROLES)
  getUsage(
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<TelemetryUsageResponse> {
    const parsed = telemetryUsageQuerySchema.parse(query);
    return this.usage.getUsage(user, parsed);
  }

  @Get('usage/org')
  @Roles(...TELEMETRY_VIEWER_ROLES)
  getOrgUsage(
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<TelemetryOrgUsageResponse> {
    if (!user.orgId) {
      throw new BadRequestException('Se requiere una organización activa.');
    }
    const filters = telemetryUsageFiltersSchema.parse(query);
    return this.report.getOrgUsage(user.orgId, filters);
  }

  @Get('admin/overview')
  @Roles('platform_admin')
  getPlatformOverview(@Query() query: unknown): Promise<TelemetryPlatformOverviewResponse> {
    const filters = telemetryUsageFiltersSchema.parse(query);
    return this.report.getPlatformOverview(filters);
  }

  @Get('admin/orgs/:orgId')
  @Roles('platform_admin')
  getAdminOrgUsage(
    @Param('orgId') orgId: string,
    @Query() query: unknown,
  ): Promise<TelemetryOrgUsageResponse> {
    const filters = telemetryUsageFiltersSchema.parse(query);
    return this.report.getOrgUsage(orgId, filters);
  }
}
