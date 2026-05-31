import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ANALYTICS_VIEWER_ROLES,
  generationalComparisonQuerySchema,
  progressionQuerySchema,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(RolesGuard)
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  /**
   * GET /api/analytics/generational  (H6.3)
   * Compara un grade entre años académicos. Agrupa por academic_years.year.
   * Puede devolver 0 o 1 punto si sólo hay datos de un período.
   */
  @Get('generational')
  @Roles(...ANALYTICS_VIEWER_ROLES)
  generational(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = generationalComparisonQuerySchema.parse(query ?? {});
    return this.service.generational(user, dto);
  }

  /**
   * GET /api/analytics/progression  (H6.6)
   * Serie temporal de % logro a través de las evaluaciones de un período. El
   * scope (student|class|skill) determina la entidad medida.
   */
  @Get('progression')
  @Roles(...ANALYTICS_VIEWER_ROLES)
  progression(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = progressionQuerySchema.parse(query ?? {});
    return this.service.progression(user, dto);
  }
}
