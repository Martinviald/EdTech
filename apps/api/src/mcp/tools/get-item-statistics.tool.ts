import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ITEM_ANALYSIS_VIEWER_ROLES } from '@soe/types';
import { ItemAnalysisService } from '../../item-analysis/item-analysis.service';
import type { AnalyticsPrincipal } from '../core/analytics-principal';
import { AnalyticsTool, type ToolDescriptor } from '../core/analytics-tool';

const inputSchema = z.object({
  itemId: z.string().uuid(),
  assessmentId: z.string().uuid().optional(),
  classGroupId: z.string().uuid().optional(),
});

type Input = z.infer<typeof inputSchema>;

@AnalyticsTool()
@Injectable()
export class GetItemStatisticsTool implements AnalyticsTool<Input, unknown> {
  readonly descriptor: ToolDescriptor = {
    name: 'get_item_statistics',
    description:
      'Estadística empírica de un ítem: p-value (proporción de acierto = dificultad REAL), ' +
      'distribución de respuestas por alternativa (análisis de distractores) y omitidas. ' +
      'Contrástalo con la dificultad declarada de get_instrument_blueprint para detectar ítems ' +
      'miscalibrados o de baja discriminación.',
    inputSchema,
    requiredRoles: ITEM_ANALYSIS_VIEWER_ROLES,
    piiLevel: 'aggregate',
  };

  constructor(private readonly itemAnalysis: ItemAnalysisService) {}

  async execute(principal: AnalyticsPrincipal, input: Input): Promise<unknown> {
    const { itemId, ...query } = input;
    return this.itemAnalysis.getQuestionAnalysis(principal, itemId, query);
  }
}
