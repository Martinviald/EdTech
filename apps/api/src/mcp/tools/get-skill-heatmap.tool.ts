import { Injectable } from '@nestjs/common';
import { HEATMAP_VIEWER_ROLES, heatmapQuerySchema, type HeatmapQueryDto } from '@soe/types';
import { HeatmapService } from '../../heatmap/heatmap.service';
import type { AnalyticsPrincipal } from '../core/analytics-principal';
import { AnalyticsTool, type ToolDescriptor } from '../core/analytics-tool';

@AnalyticsTool()
@Injectable()
export class GetSkillHeatmapTool implements AnalyticsTool<HeatmapQueryDto, unknown> {
  readonly descriptor: ToolDescriptor = {
    name: 'get_skill_heatmap',
    description:
      'Matriz de logro habilidad × asignatura (por curso o grado), con niveles de desempeño. ' +
      'Vista panorámica para ubicar dónde se concentran las brechas antes de profundizar con ' +
      'get_skill_gaps o get_item_statistics.',
    inputSchema: heatmapQuerySchema,
    requiredRoles: HEATMAP_VIEWER_ROLES,
    piiLevel: 'aggregate',
  };

  constructor(private readonly heatmap: HeatmapService) {}

  async execute(principal: AnalyticsPrincipal, input: HeatmapQueryDto): Promise<unknown> {
    return this.heatmap.getHeatmap(principal, input);
  }
}
