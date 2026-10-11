import type { LlmFeature, ResponseFormatKind } from '@soe/types';

export const ANSWER_READING_JOB_KIND = 'answer_reading';

export const ANSWER_READING_LLM_FEATURE = 'answer_transcription' satisfies LlmFeature;

export const VISION_SHORT_ANSWER_FORMAT_KINDS = [
  'integer',
  'decimal',
  'fraction',
  'ordered_tuple',
  'sequence',
] as const satisfies readonly ResponseFormatKind[];

export const ANSWER_READING_OPTIONS = 'ANSWER_READING_OPTIONS';

export interface AnswerReadingOptions {
  readonly maxCropsPerRun: number;
  readonly cropConcurrency: number;
  readonly retryDelayMs: number;
  readonly defaultEstimatedReadingCostUsd: number;
}

export const DEFAULT_ANSWER_READING_OPTIONS: AnswerReadingOptions = {
  maxCropsPerRun: 2000,
  cropConcurrency: 4,
  retryDelayMs: 500,
  defaultEstimatedReadingCostUsd: 0.001,
};
