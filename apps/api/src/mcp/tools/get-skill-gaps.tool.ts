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
export class GetSkillGapsTool implements AnalyticsTool<DashboardFiltersQueryDto, unknown> {
  readonly descriptor: ToolDescriptor = {
    name: 'get_skill_gaps',
    description:
      'Logro promedio por habilidad (nodo de taxonomía) para el alcance filtrado ' +
      '(evaluación, instrumento, asignatura, grado o curso). Menor % = mayor brecha. ' +
      'Cruza cada habilidad con los ítems que la miden (get_instrument_blueprint) para juzgar si ' +
      'la brecha es real o un artefacto del instrumento.',
    inputSchema: dashboardFiltersQuerySchema,
    requiredRoles: DASHBOARD_VIEWER_ROLES,
    piiLevel: 'aggregate',
  };

  constructor(private readonly dashboards: DashboardsService) {}

  async execute(
    principal: AnalyticsPrincipal,
    input: DashboardFiltersQueryDto,
  ): Promise<unknown> {
    return this.dashboards.getSkills(principal, input);
  }
}
