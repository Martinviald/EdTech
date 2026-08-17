import { Injectable } from '@nestjs/common';
import {
  ITEM_ANALYSIS_VIEWER_ROLES,
  assessmentListQuerySchema,
  type AssessmentListQueryDto,
} from '@soe/types';
import { ItemAnalysisService } from '../../item-analysis/item-analysis.service';
import type { AnalyticsPrincipal } from '../core/analytics-principal';
import { AnalyticsTool, type ToolDescriptor } from '../core/analytics-tool';

@AnalyticsTool()
@Injectable()
export class ListAssessmentsTool implements AnalyticsTool<AssessmentListQueryDto, unknown> {
  readonly descriptor: ToolDescriptor = {
    name: 'list_assessments',
    description:
      'Lista las evaluaciones con resultados visibles para el usuario, filtrables por asignatura, ' +
      'grado, curso, período, tipo y año. Punto de entrada para descubrir qué evaluar antes de ' +
      'pedir su detalle con las demás herramientas.',
    inputSchema: assessmentListQuerySchema,
    requiredRoles: ITEM_ANALYSIS_VIEWER_ROLES,
    piiLevel: 'aggregate',
  };

  constructor(private readonly itemAnalysis: ItemAnalysisService) {}

  async execute(
    principal: AnalyticsPrincipal,
    input: AssessmentListQueryDto,
  ): Promise<unknown> {
    return this.itemAnalysis.listAssessments(principal, input);
  }
}
