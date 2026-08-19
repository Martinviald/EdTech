import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import {
  ingestTelemetrySchema,
  telemetryUsageQuerySchema,
  TELEMETRY_VIEWER_ROLES,
  type IngestTelemetryResponse,
  type TelemetryUsageResponse,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { TelemetryService } from './telemetry.service';
import { TelemetryUsageService } from './telemetry-usage.service';

@Controller('telemetry')
@UseGuards(RolesGuard)
export class TelemetryController {
  constructor(
    private readonly telemetry: TelemetryService,
    private readonly usage: TelemetryUsageService,
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
}
