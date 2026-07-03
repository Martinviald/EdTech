import { Body, Controller, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  AI_ANALYSIS_GENERATOR_ROLES,
  generateItemInsightSchema,
  type AiAnalysisModel,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { RequireFeature } from '../common/decorators/feature.decorator';
import { FeatureGuard } from '../common/guards/feature.guard';
import { JOB_DISPATCHER, type JobDispatcher } from '../jobs/job-dispatcher';
import { AiAnalysisService } from './ai-analysis.service';
import { ItemInsightRunner } from './item-insight.runner';

/**
 * Endpoint del análisis IA POR-PREGUNTA (drill-down, H20.8).
 *
 * El GET de polling es el `GET /api/ai-analysis/:id` del `AiAnalysisController`
 * (no se duplica aquí).
 */
@Controller('ai-analysis')
@UseGuards(RolesGuard, FeatureGuard)
@RequireFeature('ai_analysis')
export class ItemInsightController {
  constructor(
    private readonly service: AiAnalysisService,
    private readonly runner: ItemInsightRunner,
    @Inject(JOB_DISPATCHER) private readonly dispatcher: JobDispatcher,
  ) {}

  /**
   * POST /api/ai-analysis/items/:itemId/generate
   *
   * Crea (o reutiliza desde caché) el registro de análisis por-pregunta. Si no
   * proviene de caché, encola la ejecución async vía `JOB_DISPATCHER`. Responde
   * `{ analysisId, status }` para que el frontend haga polling con `GET /:id`.
   */
  @Post('items/:itemId/generate')
  @Roles(...AI_ANALYSIS_GENERATOR_ROLES)
  async generate(
    @Param('itemId') itemId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ analysisId: string; status: AiAnalysisModel['status'] }> {
    const dto = generateItemInsightSchema.parse(body);
    const { analysis, fromCache } = await this.service.createForItem(
      user,
      itemId,
      dto,
    );

    if (!fromCache) {
      const orgId = user.orgId as string; // createForItem ya validó que existe
      const analysisId = analysis.id;
      this.dispatcher.enqueue({
        id: analysisId,
        kind: 'ai_analysis',
        run: () => this.runner.run(analysisId, orgId),
      });
    }

    return { analysisId: analysis.id, status: analysis.status };
  }
}
