import type { LlmFeature, ResponseFormatKind } from '@soe/types';

export const ANSWER_READING_JOB_KIND = 'answer_reading';

export const ANSWER_READING_LLM_FEATURE = 'answer_transcription' satisfies LlmFeature;

export const RUBRIC_GRADING_JOB_KIND = 'rubric_grading';

export const RUBRIC_GRADING_LLM_FEATURE = 'rubric_grading' satisfies LlmFeature;

export const RUBRIC_GRADING_JOB_TYPE = 'rubric_level';

export const RUBRIC_GRADING_PROMPT_REF = 'grade.rubric@1';

export const VISION_SHORT_ANSWER_FORMAT_KINDS = [
  'integer',
  'decimal',
  'fraction',
  'ordered_tuple',
  'sequence',
] as const satisfies readonly ResponseFormatKind[];

export const VISION_TEXT_FORMAT_KINDS = [
  'word_list',
  'short_text',
  'multi_box',
] as const satisfies readonly ResponseFormatKind[];

export const VISION_RUBRIC_FORMAT_KINDS = [
  'free_text',
  'math_work',
] as const satisfies readonly ResponseFormatKind[];

export const VISION_READING_FORMAT_KINDS: readonly ResponseFormatKind[] = [
  ...VISION_SHORT_ANSWER_FORMAT_KINDS,
  ...VISION_TEXT_FORMAT_KINDS,
  ...VISION_RUBRIC_FORMAT_KINDS,
];

export const ANSWER_READING_OPTIONS = 'ANSWER_READING_OPTIONS';

export interface AnswerReadingOptions {
  readonly maxCropsPerRun: number;
  readonly cropConcurrency: number;
  readonly retryDelayMs: number;
  readonly defaultEstimatedReadingCostUsd: number;
  readonly maxRubricGradingsPerRun: number;
  readonly rubricGradingMaxOutputTokens: number;
  readonly rubricGradingTimeoutMs: number;
}

export const DEFAULT_ANSWER_READING_OPTIONS: AnswerReadingOptions = {
  maxCropsPerRun: 2000,
  cropConcurrency: 4,
  retryDelayMs: 500,
  defaultEstimatedReadingCostUsd: 0.001,
  maxRubricGradingsPerRun: 500,
  rubricGradingMaxOutputTokens: 1024,
  rubricGradingTimeoutMs: 30000,
};
