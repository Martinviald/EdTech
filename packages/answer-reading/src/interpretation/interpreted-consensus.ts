import {
  reviewModeFor,
  type AnswerSpace,
  type ConsensusPolicy,
  type ConsensusResult,
  type DecisionTiebreak,
  type InterpretedReading,
  type NormalizedAnswer,
  type ResponseFormat,
  type ReviewReason,
  type ScoringOutcome,
  type TranscriptionOutput,
  type VisionProvider,
} from '@soe/types';
import type { AcceptanceAgreement, AcceptanceDecision } from '../answer-verification/acceptance';
import type {
  AnswerStrength,
  CrossSupport,
  InkEvidence,
  VerifiedAnswer,
  VerifyAnswer,
} from '../answer-verification/verified-answer';
import { isAuditSample } from '../consensus/audit-sample';
import type { ConsensusReading } from '../consensus/evaluate-consensus';
import { normalizeTranscription } from '../formats/registry';

// Consenso de la lectura interpretada (diseño v5, pasos 2–4 y 6):
// 1. `planInterpretedConsensus`: verifica la respuesta de cada lector contra el espacio y lo
//    escrito (verifyAnswer, con el literal del OTRO lector como evidencia) y busca acuerdo
//    sobre el valor canónico. Sin acuerdo, arma los candidatos para el desempate.
// 2. `applyDecisionTiebreak`: el motor de decisiones elige entre las respuestas de los
//    lectores. Solo vale si coincide con el lector de `agreeWithProvider`, sobre su umbral y
//    con la respuesta sostenida por lo escrito; nunca sube la fuerza (máximo `inferred`).
// 3. `finalizeInterpretedConsensus`: traduce la decisión de la política de aceptación a un
//    `ConsensusResult`, el mismo que persiste el modo literal.

export interface InterpretedReaderResult {
  readonly readingId: string;
  readonly provider: VisionProvider;
  readonly family: string;
  /** Umbral del lector: bajo él la lectura no vota por consenso (sí entra al desempate). */
  readonly minConfidence: number;
  /** `null` cuando la llamada falló (tiempo, proveedor, salida inválida). */
  readonly reading: InterpretedReading | null;
}

export interface InterpretedPlanInput {
  readonly readers: readonly InterpretedReaderResult[];
  readonly verify: VerifyAnswer;
  readonly format: ResponseFormat;
  readonly space: AnswerSpace;
  readonly ink?: InkEvidence | null;
}

export interface TiebreakCandidate {
  /** La respuesta tal como la escribió el lector: es lo que ve el motor de decisiones. */
  readonly text: string;
  /** Índices (en `readers`) de los lectores que propusieron esta respuesta. */
  readonly readerIndexes: readonly number[];
}

export interface InterpretedPlan {
  readonly readers: readonly InterpretedReaderResult[];
  readonly verified: readonly (VerifiedAnswer | null)[];
  readonly agreement: AcceptanceAgreement | null;
  readonly tiebreakCandidates: readonly TiebreakCandidate[];
  readonly reasons: readonly ReviewReason[];
}

const STRENGTH_ORDER: readonly AnswerStrength[] = ['direct', 'inferred', 'selection'];

function weakestStrength(strengths: readonly AnswerStrength[]): AnswerStrength {
  return strengths.reduce((weakest, strength) =>
    STRENGTH_ORDER.indexOf(strength) > STRENGTH_ORDER.indexOf(weakest) ? strength : weakest,
  );
}

function weakestCrossSupport(supports: readonly CrossSupport[]): CrossSupport {
  if (supports.includes('unsupported')) return 'unsupported';
  if (supports.every((support) => support === 'supported')) return 'supported';
  return 'no_other';
}

function sameAnswerKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

/**
 * Candidatos del desempate: la respuesta de cada lector que contestó, sin repetir (sin
 * distinguir mayúsculas ni espacios), en el orden de los lectores de la ruta.
 */
export function tiebreakCandidatesOf(
  readers: readonly InterpretedReaderResult[],
): TiebreakCandidate[] {
  const candidates: { text: string; readerIndexes: number[] }[] = [];
  readers.forEach((reader, index) => {
    const answer = reader.reading?.answer.trim() ?? '';
    if (reader.reading?.state !== 'answered' || answer === '') return;
    const existing = candidates.find(
      (candidate) => sameAnswerKey(candidate.text) === sameAnswerKey(answer),
    );
    if (existing) existing.readerIndexes.push(index);
    else candidates.push({ text: answer, readerIndexes: [index] });
  });
  return candidates;
}

function reasonOf(verified: VerifiedAnswer | null): ReviewReason | null {
  if (verified === null) return 'reader_failed';
  switch (verified.status) {
    case 'out_of_space':
      return 'answer_out_of_space';
    case 'not_derivable':
      return 'answer_not_derivable';
    case 'ambiguous':
      return 'multiple_answers';
    case 'unreadable':
      return 'illegible';
    case 'not_applicable':
      return 'format_mismatch';
    default:
      return null;
  }
}

function confident(reader: InterpretedReaderResult): boolean {
  return reader.reading !== null && reader.reading.confidence >= reader.minConfidence;
}

function agreementOf(
  readers: readonly InterpretedReaderResult[],
  verified: readonly (VerifiedAnswer | null)[],
): AcceptanceAgreement | null {
  if (readers.length < 2 || !readers.every(confident)) return null;
  const answers = verified.filter(
    (entry): entry is Extract<VerifiedAnswer, { status: 'unique' }> => entry?.status === 'unique',
  );
  if (answers.length === verified.length) {
    const [first] = answers;
    if (!first || !answers.every((answer) => answer.canonical === first.canonical)) return null;
    return {
      kind: 'answer',
      canonical: first.canonical,
      answerText: first.answerText,
      via: 'consensus',
      strength: weakestStrength(answers.map((answer) => answer.strength)),
      crossSupport: weakestCrossSupport(answers.map((answer) => answer.crossSupport)),
    };
  }
  const blanks = verified.filter(
    (entry): entry is Extract<VerifiedAnswer, { status: 'blank' }> => entry?.status === 'blank',
  );
  if (blanks.length !== verified.length) return null;
  return {
    kind: 'blank',
    blankEvidence: blanks.every((blank) => blank.blankEvidence === 'ink_absent')
      ? 'ink_absent'
      : 'unverified',
  };
}

function disagreementReasons(
  readers: readonly InterpretedReaderResult[],
  verified: readonly (VerifiedAnswer | null)[],
): ReviewReason[] {
  const reasons = new Set<ReviewReason>();
  verified.forEach((entry) => {
    const reason = reasonOf(entry);
    if (reason) reasons.add(reason);
  });
  if (readers.some((reader) => reader.reading !== null && !confident(reader))) {
    reasons.add('low_confidence');
  }
  const canonicals = new Set(
    verified.flatMap((entry) => (entry?.status === 'unique' ? [entry.canonical] : [])),
  );
  if (canonicals.size > 1 || (canonicals.size === 1 && reasons.size === 0)) {
    reasons.add('readers_disagree');
  }
  if (readers.length < 2) reasons.add('insufficient_readers');
  if (reasons.size === 0) reasons.add('readers_disagree');
  return [...reasons];
}

export function planInterpretedConsensus(input: InterpretedPlanInput): InterpretedPlan {
  const { readers, verify, format, space, ink } = input;
  const verified = readers.map((reader, index) => {
    if (reader.reading === null) return null;
    const other = readers.find((_, otherIndex) => otherIndex !== index)?.reading ?? null;
    return verify({ reading: reader.reading, otherReading: other, format, space, ink: ink ?? null });
  });
  const agreement = agreementOf(readers, verified);
  if (agreement) return { readers, verified, agreement, tiebreakCandidates: [], reasons: [] };
  return {
    readers,
    verified,
    agreement: null,
    tiebreakCandidates: tiebreakCandidatesOf(readers),
    reasons: disagreementReasons(readers, verified),
  };
}

/** Lo que eligió el motor de decisiones, ya traducido de su clave a un candidato. */
export type TiebreakChoice =
  | { readonly kind: 'candidate'; readonly text: string; readonly confidence: number }
  | { readonly kind: 'blank'; readonly confidence: number }
  | { readonly kind: 'other'; readonly confidence: number };

export function applyDecisionTiebreak(
  plan: InterpretedPlan,
  choice: TiebreakChoice | null,
  rule: DecisionTiebreak,
): AcceptanceAgreement | null {
  if (plan.agreement || choice === null || choice.confidence < rule.minConfidence) return null;
  if (choice.kind === 'other') return null;
  if (choice.kind === 'blank') {
    const inkAbsent = plan.verified.some(
      (entry) => entry?.status === 'blank' && entry.blankEvidence === 'ink_absent',
    );
    return inkAbsent ? { kind: 'blank', blankEvidence: 'ink_absent' } : null;
  }
  const candidate = plan.tiebreakCandidates.find(
    (entry) => sameAnswerKey(entry.text) === sameAnswerKey(choice.text),
  );
  if (!candidate) return null;
  const anchorIndex = candidate.readerIndexes.find(
    (index) => plan.readers[index]?.provider === rule.agreeWithProvider,
  );
  if (anchorIndex === undefined) return null;
  const anchor = plan.verified[anchorIndex];
  if (anchor?.status !== 'unique' || anchor.crossSupport === 'unsupported') return null;
  return {
    kind: 'answer',
    canonical: anchor.canonical,
    answerText: anchor.answerText,
    via: 'tiebreak',
    strength: anchor.strength === 'direct' ? 'inferred' : anchor.strength,
    crossSupport: anchor.crossSupport,
  };
}

/** Valor normalizado de lo acordado, con el mismo normalizador que el modo literal. */
export function agreedValue(
  agreement: AcceptanceAgreement,
  format: ResponseFormat,
): NormalizedAnswer {
  return normalizeTranscription(agreedOutput(agreement), format);
}

/** Lecturas que sostienen lo acordado: las que coincidieron, o el lector ancla del desempate. */
export function supportingReadingIds(
  plan: InterpretedPlan,
  agreement: AcceptanceAgreement,
): string[] {
  return plan.readers.flatMap((reader, index) => {
    const entry = plan.verified[index];
    if (agreement.kind === 'blank') return entry?.status === 'blank' ? [reader.readingId] : [];
    return entry?.status === 'unique' && entry.canonical === agreement.canonical
      ? [reader.readingId]
      : [];
  });
}

function agreedOutput(agreement: AcceptanceAgreement): TranscriptionOutput {
  return {
    characters: [],
    state: agreement.kind === 'blank' ? 'blank' : 'answered',
    literal: agreement.kind === 'blank' ? '' : agreement.answerText,
    parts: null,
    alternativeReadings: [],
    confidence: 1,
    reviewRequested: false,
    notes: '',
  };
}

/**
 * Las lecturas que sostienen lo acordado, con la respuesta acordada como literal: es lo que
 * necesita el verificador de incorrectas (`agreedReadingOf`) para armar su prompt.
 */
export function agreedConsensusReadings(
  plan: InterpretedPlan,
  agreement: AcceptanceAgreement,
): ConsensusReading[] {
  const supporting = new Set(supportingReadingIds(plan, agreement));
  return plan.readers.flatMap((reader) =>
    supporting.has(reader.readingId)
      ? [
          {
            readingId: reader.readingId,
            family: reader.family,
            provider: reader.provider,
            status: 'ok' as const,
            output: agreedOutput(agreement),
            role: 'primary' as const,
          },
        ]
      : [],
  );
}

export interface FinalizeInterpretedInput {
  readonly plan: InterpretedPlan;
  readonly agreement: AcceptanceAgreement | null;
  readonly value: NormalizedAnswer | null;
  readonly scoring: ScoringOutcome | null;
  readonly decision: AcceptanceDecision;
  readonly policy: Pick<
    ConsensusPolicy,
    'id' | 'version' | 'autoAccept' | 'auditSampleRate' | 'incorrectVerifier'
  >;
  readonly readingKey: string;
}

export function finalizeInterpretedConsensus(input: FinalizeInterpretedInput): ConsensusResult {
  const { plan, agreement, value, scoring, decision, policy, readingKey } = input;
  const usedReadingIds = agreement
    ? supportingReadingIds(plan, agreement)
    : plan.readers.flatMap((reader) => (reader.reading ? [reader.readingId] : []));
  const base = { usedReadingIds, policyId: policy.id, policyVersion: policy.version };
  const review = (reasons: readonly ReviewReason[]): ConsensusResult => ({
    ...base,
    outcome: 'needs_review',
    value,
    scoringOutcome: scoring,
    reasons: [...reasons],
    reviewMode: reviewModeFor(reasons),
  });
  if (decision.action === 'review') {
    return review(decision.reasons.length > 0 ? decision.reasons : plan.reasons);
  }
  if (!policy.autoAccept) return review(['policy_requires_review']);
  if (decision.action === 'verify_incorrect' && policy.incorrectVerifier === undefined) {
    return review(['verifier_failed']);
  }
  if (isAuditSample(readingKey, policy.auditSampleRate)) return review(['audit_sample']);
  return {
    ...base,
    outcome: decision.action === 'accept_blank' ? 'auto_blank' : 'auto_accepted',
    value,
    scoringOutcome: scoring,
    reasons: [],
    reviewMode: null,
  };
}
