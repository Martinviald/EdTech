import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  AI_ANALYSIS_GENERATOR_ROLES,
  AI_ANALYSIS_VIEWER_ROLES,
  findLatestAnalysisQuerySchema,
  generateAnalysisSchema,
  type AiAnalysisModel,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { RequireCapability } from '../common/decorators/capability.decorator';
import { CapabilityGuard } from '../common/guards/capability.guard';
import { RequireFeature } from '../common/decorators/feature.decorator';
import { FeatureGuard } from '../common/guards/feature.guard';
import { JOB_DISPATCHER, type JobDispatcher } from '../jobs/job-dispatcher';
import { AiAnalysisService } from './ai-analysis.service';
import { AiAnalysisRunner } from './ai-analysis.runner';

@Controller('ai-analysis')
@UseGuards(RolesGuard, FeatureGuard, CapabilityGuard)
@RequireFeature('ai_analysis')
export class AiAnalysisController {
  constructor(
    private readonly service: AiAnalysisService,
    private readonly runner: AiAnalysisRunner,
    @Inject(JOB_DISPATCHER) private readonly dispatcher: JobDispatcher,
  ) {}

  /**
   * POST /api/ai-analysis/assessments/:assessmentId/generate
   *
   * Crea (o reutiliza desde caché) el registro de análisis. Si no proviene de
   * caché, encola la ejecución async vía el puerto `JOB_DISPATCHER`. Responde
   * `{ analysisId, status }` para que el frontend haga polling con `GET /:id`.
   *
   * `@RequireCapability('ai_item_insight')`: el snapshot lee `responses` para armar
   * la ScoreMatrix y la psicometría por ítem. Sin ellas `assembleItems` NO lanza —
   * arma ítems con `distribution: {}` y `pointBiserial: null`, y el LLM recibe un
   * snapshot con alumnos y habilidades pero sin evidencia, sin ninguna señal de "no
   * aplica". Generar el informe igual sería invitar a la alucinación, así que se
   * cierra antes de encolar. Ver docs/plan-analitica-agregada-informes-oficiales.md §2.8.
   */
  @Post('assessments/:assessmentId/generate')
  @Roles(...AI_ANALYSIS_GENERATOR_ROLES)
  @RequireCapability('ai_item_insight')
  async generate(
    @Param('assessmentId') assessmentId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ analysisId: string; status: AiAnalysisModel['status'] }> {
    const dto = generateAnalysisSchema.parse(body);
    const { analysis, fromCache } = await this.service.create(user, assessmentId, dto);

    if (!fromCache) {
      const orgId = user.orgId as string; // service.create ya validó que existe
      const analysisId = analysis.id;
      this.dispatcher.enqueue({
        id: analysisId,
        kind: 'ai_analysis',
        run: () => this.runner.run(analysisId, orgId),
      });
    }

    return { analysisId: analysis.id, status: analysis.status };
  }

  /**
   * GET /api/ai-analysis/assessments/:assessmentId/latest
   *
   * Devuelve el último análisis YA EXISTENTE para la evaluación (mismo scope que la
   * caché: analysisType + audience + classGroupId), o `null` si no hay. No genera
   * nada. La vista lo usa para cargar el informe creado previamente al re-seleccionar
   * la evaluación (sin `analysisId` en la URL).
   */
  @Get('assessments/:assessmentId/latest')
  @Roles(...AI_ANALYSIS_VIEWER_ROLES)
  findLatest(
    @Param('assessmentId') assessmentId: string,
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<AiAnalysisModel | null> {
    const q = findLatestAnalysisQuerySchema.parse(query);
    return this.service.findLatestForAssessment(user, {
      assessmentId,
      analysisType: q.analysisType,
      audience: q.audience,
      classGroupId: q.classGroupId ?? null,
    });
  }

  /** GET /api/ai-analysis/:id — poll del estado/salida del análisis. */
  @Get(':id')
  @Roles(...AI_ANALYSIS_VIEWER_ROLES)
  get(@Param('id') id: string, @CurrentUser() user: JwtPayload): Promise<AiAnalysisModel> {
    return this.service.get(user, id);
  }
}
