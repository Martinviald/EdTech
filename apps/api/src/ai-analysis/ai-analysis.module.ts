import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { JobsModule } from '../jobs/jobs.module';
import { AssessmentReportModule } from '../assessment-report/assessment-report.module';
import { AiAnalysisController } from './ai-analysis.controller';
import { AiAnalysisService } from './ai-analysis.service';
import { AiAnalysisRunner } from './ai-analysis.runner';
import { SnapshotService } from './ai-analysis.snapshot';
import { SNAPSHOT_BUILDER } from './snapshot.port';

/**
 * Motor IA base (H19.23) + informe IA de evaluación (F2 S1, E20).
 * Registro + caché sobre `LlmService`, ejecución async vía `JOB_DISPATCHER`,
 * y snapshot determinista (`SNAPSHOT_BUILDER`) que reusa `AssessmentReportService`.
 */
@Module({
  imports: [LlmModule, JobsModule, AssessmentReportModule],
  controllers: [AiAnalysisController],
  providers: [
    AiAnalysisService,
    AiAnalysisRunner,
    { provide: SNAPSHOT_BUILDER, useClass: SnapshotService },
  ],
  exports: [AiAnalysisService],
})
export class AiAnalysisModule {}
