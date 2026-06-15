import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { JobsModule } from '../jobs/jobs.module';
import { AssessmentReportModule } from '../assessment-report/assessment-report.module';
import { ItemAnalysisModule } from '../item-analysis/item-analysis.module';
import { AiAnalysisController } from './ai-analysis.controller';
import { AiAnalysisService } from './ai-analysis.service';
import { AiAnalysisRunner } from './ai-analysis.runner';
import { SnapshotService } from './ai-analysis.snapshot';
import { SNAPSHOT_BUILDER } from './snapshot.port';
import { ItemInsightController } from './item-insight.controller';
import { ItemInsightRunner } from './item-insight.runner';
import { ItemInsightSnapshotService } from './item-insight.snapshot';
import { ITEM_INSIGHT_BUILDER } from './item-insight.port';
import { FeatureGuard } from '../common/guards/feature.guard';

/**
 * Motor IA base (H19.23) + informe IA de evaluación (F2 S1, E20) + análisis IA
 * por-pregunta multimodal (F2 S2, H20.8). Registro + caché sobre `LlmService`,
 * ejecución async vía `JOB_DISPATCHER`, snapshot determinista de evaluación
 * (`SNAPSHOT_BUILDER`, reusa `AssessmentReportService`) y snapshot por-pregunta
 * (`ITEM_INSIGHT_BUILDER`, reusa `ItemAnalysisService` + `AssessmentReportService`).
 */
@Module({
  imports: [LlmModule, JobsModule, AssessmentReportModule, ItemAnalysisModule],
  controllers: [AiAnalysisController, ItemInsightController],
  providers: [
    AiAnalysisService,
    AiAnalysisRunner,
    { provide: SNAPSHOT_BUILDER, useClass: SnapshotService },
    ItemInsightRunner,
    { provide: ITEM_INSIGHT_BUILDER, useClass: ItemInsightSnapshotService },
    FeatureGuard,
  ],
  exports: [AiAnalysisService],
})
export class AiAnalysisModule {}
