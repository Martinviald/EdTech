import { Module } from '@nestjs/common';
import { AiObservabilityModule } from '../ai-observability/ai-observability.module';
import { AssessmentResultsModule } from '../assessment-results/assessment-results.module';
import { FilesModule } from '../files/files.module';
import { JobsModule } from '../jobs/jobs.module';
import { LlmModule } from '../llm/llm.module';
import { AnswerReadingBudgetService } from './answer-reading-budget.service';
import { AnswerReadingConsolidationService } from './answer-reading-consolidation.service';
import { AnswerReadingDecisionsService } from './answer-reading-decisions.service';
import { AnswerReadingPipelineService } from './answer-reading-pipeline.service';
import {
  ANSWER_READING_OPTIONS,
  DEFAULT_ANSWER_READING_OPTIONS,
  type AnswerReadingOptions,
} from './answer-reading.constants';
import { CropReadingService } from './crop-reading.service';
import { ReadingRoutesService } from './reading-routes.service';
import { LlmVisionTranscriber } from './transcribers/llm-vision-transcriber';
import { VISION_TRANSCRIBERS, type VisionTranscriber } from './transcribers/vision-transcriber';
import { VisionTranscriberRegistry } from './transcribers/vision-transcriber.registry';

function positiveIntegerFromEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return raw !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function answerReadingOptionsFromEnv(): AnswerReadingOptions {
  return {
    ...DEFAULT_ANSWER_READING_OPTIONS,
    maxCropsPerRun: positiveIntegerFromEnv(
      process.env.ANSWER_READING_MAX_CROPS_PER_RUN,
      DEFAULT_ANSWER_READING_OPTIONS.maxCropsPerRun,
    ),
    cropConcurrency: positiveIntegerFromEnv(
      process.env.ANSWER_READING_CROP_CONCURRENCY,
      DEFAULT_ANSWER_READING_OPTIONS.cropConcurrency,
    ),
  };
}

@Module({
  imports: [FilesModule, JobsModule, LlmModule, AiObservabilityModule, AssessmentResultsModule],
  providers: [
    { provide: ANSWER_READING_OPTIONS, useFactory: answerReadingOptionsFromEnv },
    LlmVisionTranscriber,
    {
      provide: VISION_TRANSCRIBERS,
      useFactory: (llm: LlmVisionTranscriber): VisionTranscriber[] => [llm],
      inject: [LlmVisionTranscriber],
    },
    VisionTranscriberRegistry,
    ReadingRoutesService,
    AnswerReadingDecisionsService,
    AnswerReadingBudgetService,
    CropReadingService,
    AnswerReadingConsolidationService,
    AnswerReadingPipelineService,
  ],
  exports: [
    AnswerReadingPipelineService,
    AnswerReadingDecisionsService,
    AnswerReadingConsolidationService,
  ],
})
export class AnswerReadingModule {}
