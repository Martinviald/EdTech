import { Injectable } from '@nestjs/common';
import {
  DASHBOARD_VIEWER_ROLES,
  dashboardFiltersQuerySchema,
  type DashboardFiltersQueryDto,
} from '@soe/types';
import { DashboardsService } from '../../dashboards/dashboards.service';
import type { AnalyticsPrincipal } from '../core/analytics-principal';
import { AnalyticsTool, type ToolDescriptor } from '../core/analytics-tool';

@AnalyticsTool()
@Injectable()
export class GetAssessmentOverviewTool
  implements AnalyticsTool<DashboardFiltersQueryDto, unknown>
{
  readonly descriptor: ToolDescriptor = {
    name: 'get_assessment_overview',
    description:
      'Panorama de logro de una cohorte para el alcance filtrado: % de logro global, distribución ' +
      'por banda de desempeño, comparabilidad y alertas. Da el contexto agregado sobre el que se ' +
      'interpretan las brechas por habilidad y la calidad del instrumento.',
    inputSchema: dashboardFiltersQuerySchema,
    requiredRoles: DASHBOARD_VIEWER_ROLES,
    piiLevel: 'aggregate',
  };

  constructor(private readonly dashboards: DashboardsService) {}

  async execute(
    principal: AnalyticsPrincipal,
    input: DashboardFiltersQueryDto,
  ): Promise<unknown> {
    return this.dashboards.getOverview(principal, input);
  }
}
