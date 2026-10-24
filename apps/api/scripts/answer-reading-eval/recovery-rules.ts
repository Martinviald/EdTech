import {
  confusableDigitVariants,
  type AcceptanceAgreement,
  type InterpretedPlan,
  type VerifiedAnswer,
  type VerifyAnswer,
} from '@soe/answer-reading';
import type { AnswerSpace, InterpretedReading, ResponseFormat, ScoringOutcome } from '@soe/types';

export const RECOVERY_RULES = ['key_anchor', 'matching_column'] as const;
export type RecoveryRule = (typeof RECOVERY_RULES)[number];

export interface RecoveryContext {
  readonly verify: VerifyAnswer;
  readonly format: ResponseFormat;
  readonly space: AnswerSpace;
  readonly scoreOf: (agreement: AcceptanceAgreement) => ScoringOutcome | null;
  readonly anchorProvider: string;
}

export interface Recovered {
  readonly rule: RecoveryRule;
  readonly agreement: AcceptanceAgreement;
}

type UniqueAnswer = Extract<VerifiedAnswer, { status: 'unique' }>;

function keyAnchor(plan: InterpretedPlan, context: RecoveryContext): Recovered | null {
  const anchorIndex = plan.readers.findIndex(
    (reader) => reader.provider === context.anchorProvider,
  );
  const anchor = plan.readers[anchorIndex];
  const verified = plan.verified[anchorIndex];
  if (!anchor?.reading || anchor.reading.confidence < anchor.minConfidence) return null;
  if (verified?.status !== 'unique') return null;
  const agreement: AcceptanceAgreement = {
    kind: 'answer',
    canonical: verified.canonical,
    answerText: verified.answerText,
    via: 'tiebreak',
    strength: verified.strength === 'direct' ? 'inferred' : verified.strength,
    crossSupport: verified.crossSupport,
  };
  if (context.scoreOf(agreement) !== 'correct') return null;
  const variants = new Set(confusableDigitVariants(verified.answerText));
  const otherIsConfusable = plan.verified.some(
    (entry, index) =>
      index !== anchorIndex &&
      entry?.status === 'unique' &&
      (variants.has(entry.answerText) || variants.has(entry.canonical)),
  );
  return otherIsConfusable ? null : { rule: 'key_anchor', agreement };
}

function tokensOf(reading: InterpretedReading): string[] {
  const pieces = [reading.answer, ...reading.candidates, reading.literal].flatMap((text) =>
    text.split(/[\s,;–-]+|\by\b/i),
  );
  return [...new Set([reading.answer, ...pieces].map((text) => text.trim()).filter(Boolean))];
}

function inSpaceCodes(reading: InterpretedReading, context: RecoveryContext): UniqueAnswer[] {
  const found = new Map<string, UniqueAnswer>();
  for (const token of tokensOf(reading)) {
    const verified = context.verify({
      reading: { literal: token, state: 'answered', answer: token, candidates: [], confidence: 1 },
      otherReading: null,
      format: context.format,
      space: context.space,
    });
    if (verified.status === 'unique' && !found.has(verified.canonical)) {
      found.set(verified.canonical, verified);
    }
  }
  return [...found.values()];
}

function matchingColumn(plan: InterpretedPlan, context: RecoveryContext): Recovered | null {
  if (context.space.kind !== 'matching' || plan.readers.length < 2) return null;
  const perReader = plan.readers.map((reader) =>
    reader.reading ? inSpaceCodes(reader.reading, context) : [],
  );
  if (!perReader.every((codes) => codes.length === 1)) return null;
  const [first] = perReader.map((codes) => codes[0] as UniqueAnswer);
  if (!first || !perReader.every((codes) => codes[0]?.canonical === first.canonical)) return null;
  return {
    rule: 'matching_column',
    agreement: {
      kind: 'answer',
      canonical: first.canonical,
      answerText: first.answerText,
      via: 'consensus',
      strength: 'inferred',
      crossSupport: 'supported',
    },
  };
}

export function recoverAgreement(
  plan: InterpretedPlan,
  context: RecoveryContext,
  rules: ReadonlySet<RecoveryRule>,
): Recovered | null {
  if (plan.agreement) return null;
  return (
    (rules.has('matching_column') ? matchingColumn(plan, context) : null) ??
    (rules.has('key_anchor') ? keyAnchor(plan, context) : null)
  );
}
