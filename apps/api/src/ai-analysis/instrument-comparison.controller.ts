import { Body, Controller, Get, Inject, Post, Query, UseGuards } from '@nestjs/common';
import {
  AI_ANALYSIS_GENERATOR_ROLES,
  AI_ANALYSIS_VIEWER_ROLES,
  compareInstrumentsSchema,
  findLatestComparisonQuerySchema,
  type AiAnalysisModel,
  type ComparableAssessment,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { RequireFeature } from '../common/decorators/feature.decorator';
import { FeatureGuard } from '../common/guards/feature.guard';
import { JOB_DISPATCHER, type JobDispatcher } from '../jobs/job-dispatcher';
import { AiAnalysisService } from './ai-analysis.service';
import { InstrumentComparisonRunner } from './instrument-comparison.runner';

/**
 * TKT-23 — Diagnóstico IA de la variación entre dos instrumentos comparables.
 *
 * Comparte prefijo `ai-analysis` con `AiAnalysisController`: el polling del estado
 * reutiliza `GET /ai-analysis/:id` (mismo `AiAnalysisModel`, `output` = diagnóstico).
 * Rutas estáticas de dos segmentos → sin colisión con `:id`.
 */
@Controller('ai-analysis/compare-instruments')
@UseGuards(RolesGuard, FeatureGuard)
@RequireFeature('ai_analysis')
export class InstrumentComparisonController {
  constructor(
    private readonly service: AiAnalysisService,
    private readonly runner: InstrumentComparisonRunner,
    @Inject(JOB_DISPATCHER) private readonly dispatcher: JobDispatcher,
  ) {}

  /**
   * GET /api/ai-analysis/compare-instruments/candidates
   *
   * Evaluaciones con resultados + metadatos de su instrumento, para poblar el
   * selector. El frontend agrupa por `comparableKey` y solo habilita comparar dos
   * candidatas del mismo grupo.
   */
  @Get('candidates')
  @Roles(...AI_ANALYSIS_GENERATOR_ROLES)
  candidates(@CurrentUser() user: JwtPayload): Promise<ComparableAssessment[]> {
    return this.service.listComparableAssessments(user);
  }

  /**
   * POST /api/ai-analysis/compare-instruments
   *
   * Crea (o reutiliza desde caché) la comparación; si no proviene de caché, encola
   * la ejecución async vía `JOB_DISPATCHER`. Responde `{ analysisId, status }` para
   * que el frontend haga polling con `GET /ai-analysis/:id`.
   */
  @Post()
  @Roles(...AI_ANALYSIS_GENERATOR_ROLES)
  async compare(
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ analysisId: string; status: AiAnalysisModel['status'] }> {
    const dto = compareInstrumentsSchema.parse(body);
    const { analysis, fromCache } = await this.service.createComparison(user, dto);

    if (!fromCache) {
      const orgId = user.orgId as string; // createComparison ya validó que existe
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
   * GET /api/ai-analysis/compare-instruments/latest
   *
   * Última comparación YA EXISTENTE para un par de evaluaciones (mismo scope que la
   * caché), o `null`. No genera nada; permite recargar el diagnóstico al re-seleccionar.
   */
  @Get('latest')
  @Roles(...AI_ANALYSIS_VIEWER_ROLES)
  findLatest(
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<AiAnalysisModel | null> {
    const q = findLatestComparisonQuerySchema.parse(query);
    return this.service.findLatestComparison(user, {
      baseAssessmentId: q.baseAssessmentId,
      comparisonAssessmentId: q.comparisonAssessmentId,
      audience: q.audience,
    });
  }
}
