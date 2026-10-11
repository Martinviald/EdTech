import {
  formatLabelFor,
  isSupportedFormat,
  normalizeTranscription,
  toScoringOutcome,
} from '@soe/answer-reading';
import type { AnswerReadingDecision, AnswerReview } from '@soe/db';
import {
  reviewModeFor,
  type NormalizedAnswer,
  type ResponseFormat,
  type ReviewMode,
  type ReviewReason,
  type ScoringOutcome,
} from '@soe/types';
import {
  itemResponseFormat,
  scoreReadingValue,
  type ReadingScoringItem,
} from './answer-reading-scoring.helpers';

export const FALLBACK_RESPONSE_FORMAT: ResponseFormat = { kind: 'short_text', maxWords: 40 };
export const FALLBACK_FORMAT_LABEL = 'respuesta escrita';

const READING_REVIEW_ACTIONS: ReadonlySet<AnswerReview['action']> = new Set(['accept', 'edit']);

export interface PendingReview {
  readonly mode: ReviewMode;
  readonly canonical: string | null;
  readonly value: NormalizedAnswer | null;
  readonly reasons: ReviewReason[];
  readonly isAudit: boolean;
}

export function scoringOutcomeOf(
  item: ReadingScoringItem | undefined,
  value: NormalizedAnswer | null,
): ScoringOutcome {
  if (!item || value === null || value.canonical === null) return 'undecidable';
  const scored = scoreReadingValue(item, value);
  return scored === null ? 'undecidable' : toScoringOutcome(scored.output);
}

export function pendingReviewOf(
  decision: AnswerReadingDecision,
  activeReview: AnswerReview | undefined,
  item: ReadingScoringItem | undefined,
): PendingReview | null {
  if (activeReview) {
    if (!READING_REVIEW_ACTIONS.has(activeReview.action)) return null;
    const value = activeReview.resultingValue;
    if (scoringOutcomeOf(item, value) !== 'undecidable') return null;
    return {
      mode: 'grading',
      canonical: activeReview.resultingCanonical,
      value,
      reasons: [value?.canonical == null ? 'unparsed_format' : 'undecidable'],
      isAudit: false,
    };
  }
  if (decision.outcome !== 'needs_review') return null;
  return {
    mode: decision.reviewMode ?? reviewModeFor(decision.reasons),
    canonical: decision.canonical,
    value: decision.value,
    reasons: decision.reasons,
    isAudit: decision.reasons.includes('audit_sample'),
  };
}

export function decisionResponseFormat(
  snapshot: ResponseFormat | null | undefined,
  item: ReadingScoringItem | undefined,
): ResponseFormat {
  return snapshot ?? (item ? itemResponseFormat(item) : null) ?? FALLBACK_RESPONSE_FORMAT;
}

export function formatLabelOf(format: ResponseFormat): string {
  return isSupportedFormat(format) ? formatLabelFor(format) : FALLBACK_FORMAT_LABEL;
}

export function normalizeLiteral(literal: string, format: ResponseFormat): NormalizedAnswer | null {
  if (!isSupportedFormat(format)) return null;
  return normalizeTranscription(
    {
      characters: [],
      state: 'answered',
      literal,
      parts: null,
      alternativeReadings: [],
      confidence: 1,
      reviewRequested: false,
      notes: '',
    },
    format,
  );
}
