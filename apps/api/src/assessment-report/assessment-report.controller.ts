import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ANALYTICS_VIEWER_ROLES, assessmentReportQuerySchema } from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AssessmentReportService } from './assessment-report.service';

@Controller('analytics')
@UseGuards(RolesGuard)
export class AssessmentReportController {
  constructor(private readonly service: AssessmentReportService) {}

  /**
   * GET /api/analytics/assessment-report  (H6.13)
   * Informe consolidado de una evaluación para directivos / UTP: ficha técnica,
   * síntesis ejecutiva, distribución, comparativa por curso, fortalezas/brechas
   * por habilidad, análisis psicométrico de ítems y recomendaciones accionables.
   */
  @Get('assessment-report')
  @Roles(...ANALYTICS_VIEWER_ROLES)
  getReport(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = assessmentReportQuerySchema.parse(query ?? {});
    return this.service.getReport(user, dto);
  }
}
