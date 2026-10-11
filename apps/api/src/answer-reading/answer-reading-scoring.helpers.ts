import {
  ANSWER_FORMATS,
  isSupportedFormatKind,
  toScoringInput,
  toScoringOutcome,
} from '@soe/answer-reading';
import {
  getScoringStrategy,
  resolveResponseFormat,
  type ItemContent,
  type ItemType,
  type NormalizedAnswer,
  type ResponseFormat,
  type ScoringConfig,
  type ScoringOutcome,
  type ScoringOutput,
} from '@soe/types';

export interface ReadingScoringItem {
  readonly id: string;
  readonly type: ItemType;
  readonly content: ItemContent;
  readonly scoringConfig: ScoringConfig;
  readonly maxScore: number;
}

export interface ReadingItemRow {
  readonly id: string;
  readonly type: string;
  readonly content: ItemContent | null;
  readonly scoringConfig: Record<string, unknown> | null;
}

export interface ScoredReadingValue {
  readonly answer: unknown;
  readonly output: ScoringOutput;
}

export function toReadingScoringItem(row: ReadingItemRow): ReadingScoringItem {
  const scoringConfig = (row.scoringConfig ?? {}) as ScoringConfig;
  return {
    id: row.id,
    type: row.type as ItemType,
    content: (row.content ?? {}) as ItemContent,
    scoringConfig,
    maxScore: scoringConfig?.points ?? 1,
  };
}

export function itemResponseFormat(item: ReadingScoringItem): ResponseFormat | null {
  return resolveResponseFormat({ type: item.type, content: item.content });
}

export function contentWithResponseFormat(item: ReadingScoringItem): ItemContent {
  if ((item.content as { responseFormat?: unknown }).responseFormat !== undefined) {
    return item.content;
  }
  const responseFormat = itemResponseFormat(item);
  if (responseFormat === null) return item.content;
  return { ...item.content, responseFormat } as ItemContent;
}

export function scoreReadingValue(
  item: ReadingScoringItem,
  value: NormalizedAnswer,
): ScoredReadingValue | null {
  if (!isSupportedFormatKind(value.formatKind)) return null;
  if (ANSWER_FORMATS[value.formatKind].gradedBy === 'rubric') return null;
  const answer = toScoringInput(value);
  const output = getScoringStrategy(item.type).score({
    item: {
      id: item.id,
      type: item.type,
      content: contentWithResponseFormat(item),
      maxScore: item.maxScore,
      scoringConfig: item.scoringConfig,
    },
    rawAnswer: answer,
  });
  return { answer, output };
}

export function readingScoringOutcome(
  item: ReadingScoringItem | undefined,
  value: NormalizedAnswer,
): ScoringOutcome {
  if (!item) return 'undecidable';
  const scored = scoreReadingValue(item, value);
  return scored === null ? 'undecidable' : toScoringOutcome(scored.output);
}
