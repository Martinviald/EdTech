import type {
  AnswerSpace,
  ConsensusPolicy,
  InterpretedReading,
  RecoveryRule,
  RecoveryRules,
  ResponseFormat,
  ScoringOutcome,
} from '@soe/types';
import type { AcceptanceAgreement } from '../answer-verification/acceptance';
import { confusableDigitVariants } from '../answer-verification/decide-acceptance';
import type { VerifiedAnswer, VerifyAnswer } from '../answer-verification/verified-answer';
import type { InterpretedPlan } from './interpreted-consensus';

// Reglas de recuperación de la lectura interpretada: solo actúan cuando, después del
// desempate, sigue sin haber acuerdo. Lo que recuperan pasa igual por `decideAcceptance`
// (una incorrecta dudosa va al verificador), así que nunca saltan la política de aceptación.
// 1. `matching_column` (solo pareo): cada lector, mirando su respuesta, sus candidatos y lo
//    escrito, apunta a un único código de la columna, y es el mismo para todos.
// 2. `key_anchor`: el lector ancla, sobre su umbral, verifica una respuesta única que la
//    corrección da por correcta, y el otro lector no leyó una variante confundible (1↔7/4).

export interface RecoveryContext {
  readonly verify: VerifyAnswer;
  readonly format: ResponseFormat;
  readonly space: AnswerSpace;
  /** Corrección de un acuerdo candidato, por el mismo camino que el acuerdo final. */
  readonly scoreOf: (agreement: AcceptanceAgreement) => ScoringOutcome | null;
}

export interface RecoveredAgreement {
  readonly rule: RecoveryRule;
  readonly agreement: AcceptanceAgreement;
}

type UniqueAnswer = Extract<VerifiedAnswer, { status: 'unique' }>;

const NO_RECOVERY: RecoveryRules = { matchingColumn: false, keyAnchor: null };

/**
 * Reglas vigentes de una política. Sin `recoveryRules` declaradas quedan prendidas: el pareo
 * por columna siempre y el ancla de clave con el lector en que confía el desempate (sin
 * desempate no hay ancla). Solo aplican a la lectura interpretada.
 */
export function recoveryRulesOf(
  policy: Pick<ConsensusPolicy, 'readMode' | 'recoveryRules' | 'decisionTiebreak'>,
): RecoveryRules {
  if (policy.readMode !== 'interpreted') return NO_RECOVERY;
  if (policy.recoveryRules) return policy.recoveryRules;
  return {
    matchingColumn: true,
    keyAnchor: policy.decisionTiebreak
      ? { provider: policy.decisionTiebreak.agreeWithProvider }
      : null,
  };
}

function keyAnchor(
  plan: InterpretedPlan,
  provider: string,
  context: RecoveryContext,
): RecoveredAgreement | null {
  const anchorIndex = plan.readers.findIndex((reader) => reader.provider === provider);
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

function matchingColumn(
  plan: InterpretedPlan,
  context: RecoveryContext,
): RecoveredAgreement | null {
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

/**
 * Acuerdo recuperado por la primera regla que lo encuentra (`matching_column` y luego
 * `key_anchor`), o `null`. Quien llama la invoca solo si el desempate tampoco acordó; si el
 * plan ya trae acuerdo, no recupera nada.
 */
export function recoverAgreement(
  plan: InterpretedPlan,
  rules: RecoveryRules,
  context: RecoveryContext,
): RecoveredAgreement | null {
  if (plan.agreement) return null;
  return (
    (rules.matchingColumn ? matchingColumn(plan, context) : null) ??
    (rules.keyAnchor ? keyAnchor(plan, rules.keyAnchor.provider, context) : null)
  );
}
