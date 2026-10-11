import type {
  ReaderReadingSummary,
  ReviewQueueGroup,
  ReviewQueueSummary,
  RubricReviewDetail,
} from '@soe/types';

export const ITEM_ID = '11111111-1111-4111-8111-111111111111';
export const DECISION_A = '22222222-2222-4222-8222-222222222221';
export const DECISION_B = '22222222-2222-4222-8222-222222222222';
export const DECISION_C = '22222222-2222-4222-8222-222222222223';
export const REVIEW_A = '33333333-3333-4333-8333-333333333331';

export function reader(overrides: Partial<ReaderReadingSummary> = {}): ReaderReadingSummary {
  return {
    readingId: '44444444-4444-4444-8444-444444444441',
    readerKey: 'primary',
    provider: 'anthropic',
    model: 'Haiku',
    state: 'answered',
    literal: '21/10',
    canonical: '21/10',
    confidence: 0.62,
    alternatives: [],
    reviewRequested: false,
    notes: null,
    status: 'ok',
    ...overrides,
  };
}

export function readingGroup(overrides: Partial<ReviewQueueGroup> = {}): ReviewQueueGroup {
  return {
    groupKey: 'item-7:21/10:reading',
    itemId: ITEM_ID,
    printedNumber: '7',
    formatKind: 'fraction',
    responseFormat: { kind: 'fraction', allowNegative: false, allowMixed: false },
    formatLabel: 'Fracción',
    mode: 'reading',
    canonical: '21/10',
    displayValue: '21/10',
    reasons: ['readers_disagree'],
    size: 3,
    members: [
      { decisionId: DECISION_A, cropUrl: 'https://example.com/a.png', isAudit: false },
      { decisionId: DECISION_B, cropUrl: null, isAudit: false },
      { decisionId: DECISION_C, cropUrl: 'https://example.com/c.png', isAudit: true },
    ],
    readers: [
      reader({ alternatives: [{ literal: '21/16', plausibility: 0.3 }] }),
      reader({
        readingId: '44444444-4444-4444-8444-444444444442',
        readerKey: 'secondary',
        provider: 'google',
        model: 'Gemini',
        literal: '21/16',
        canonical: '21/16',
        confidence: 0.71,
      }),
    ],
    grading: null,
    ...overrides,
  };
}

export function gradingGroup(overrides: Partial<ReviewQueueGroup> = {}): ReviewQueueGroup {
  return readingGroup({
    groupKey: 'item-7:2,10:grading',
    mode: 'grading',
    canonical: '2,10',
    displayValue: '2,10',
    reasons: ['unparsed_format'],
    readers: [reader({ literal: '2,10', canonical: null })],
    grading: {
      acceptedAnswers: ['21/10'],
      unit: null,
      proposedOutcome: 'correct',
      optionOutcomes: [{ literal: '2,10', outcome: 'correct' }],
    },
    ...overrides,
  });
}

export function summary(overrides: Partial<ReviewQueueSummary> = {}): ReviewQueueSummary {
  return {
    pendingReading: 3,
    pendingGrading: 0,
    pendingAudit: 0,
    autoAccepted: 10,
    inProgress: 0,
    reviewed: 0,
    total: 13,
    byItem: [
      {
        itemId: ITEM_ID,
        printedNumber: '7',
        formatLabel: 'Fracción',
        pendingReading: 3,
        pendingGrading: 0,
      },
    ],
    ...overrides,
  };
}

export const RUBRIC_ITEM_ID = '11111111-1111-4111-8111-111111111119';
export const RUBRIC_DECISION = '22222222-2222-4222-8222-222222222229';
export const RUBRIC_TRANSCRIPTION = 'Porque el río se desbordó y tapó las calles';

export function rubricGroup(overrides: Partial<ReviewQueueGroup> = {}): ReviewQueueGroup {
  return readingGroup({
    groupKey: 'item-12:rubric',
    itemId: RUBRIC_ITEM_ID,
    printedNumber: '12',
    formatKind: 'free_text',
    responseFormat: { kind: 'free_text', lines: 6 },
    formatLabel: 'Texto libre',
    mode: 'grading',
    canonical: RUBRIC_TRANSCRIPTION,
    displayValue: RUBRIC_TRANSCRIPTION,
    reasons: ['rubric_item'],
    size: 1,
    members: [{ decisionId: RUBRIC_DECISION, cropUrl: null, isAudit: false }],
    readers: [],
    grading: null,
    ...overrides,
  });
}

export function rubricDetail(overrides: Partial<RubricReviewDetail> = {}): RubricReviewDetail {
  return {
    decisionId: RUBRIC_DECISION,
    itemId: RUBRIC_ITEM_ID,
    printedNumber: '12',
    formatKind: 'free_text',
    stem: '¿Por qué se inundó el pueblo?',
    transcription: RUBRIC_TRANSCRIPTION,
    cropUrl: 'https://example.com/rubrica.png',
    maxScore: 2,
    levels: [
      {
        code: '0',
        label: 'Incorrecta',
        descriptor: 'No da una causa.',
        creditFraction: 0,
        score: 0,
      },
      { code: '1', label: 'Parcial', descriptor: 'Da la causa.', creditFraction: 0.5, score: 1 },
      {
        code: '2',
        label: 'Completa',
        descriptor: 'Explica la causa.',
        creditFraction: 1,
        score: 2,
      },
    ],
    proposal: {
      levelCode: '1',
      score: 1,
      confidence: 0.8,
      rationale: 'Da la causa, pero no explica cómo provocó la inundación.',
      evidenceQuotes: ['el río se desbordó'],
      model: 'gemini-3.5-flash-lite',
      promptVersion: 'grade.rubric@1',
    },
    approval: null,
    pending: true,
    awaitingConfirmation: false,
    ...overrides,
  };
}
