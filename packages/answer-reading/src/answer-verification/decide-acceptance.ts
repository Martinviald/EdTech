import type { ReviewReason } from '@soe/types';
import type { AcceptanceDecision, AcceptanceInput, VerifyIncorrectCause } from './acceptance';
import type { VerifiedAnswer } from './verified-answer';

/** El «1» chileno se lee como 7 o como 4, y al revés. */
const CONFUSABLE_DIGITS: Readonly<Record<string, readonly string[]>> = {
  '1': ['7', '4'],
  '7': ['1'],
  '4': ['1'],
};

/**
 * Las lecturas alternativas de una respuesta cambiando UN dígito confundible.
 * Si alguna es correcta, una incorrecta no se acepta sin pasar por el verificador.
 */
export function confusableDigitVariants(answerText: string): string[] {
  const variants = new Set<string>();
  [...answerText].forEach((char, position) => {
    for (const replacement of CONFUSABLE_DIGITS[char] ?? []) {
      variants.add(answerText.slice(0, position) + replacement + answerText.slice(position + 1));
    }
  });
  return [...variants];
}

const REASON_BY_STATUS: Partial<Record<VerifiedAnswer['status'], ReviewReason>> = {
  out_of_space: 'answer_out_of_space',
  not_derivable: 'answer_not_derivable',
  unreadable: 'illegible',
  ambiguous: 'multiple_answers',
};

function reasonsWithoutAgreement(verified: readonly VerifiedAnswer[]): ReviewReason[] {
  const reasons = new Set<ReviewReason>();
  for (const answer of verified) {
    const reason = REASON_BY_STATUS[answer.status];
    if (reason) reasons.add(reason);
    if (answer.status === 'blank' && answer.blankEvidence === 'unverified') {
      reasons.add('blank_unverified');
    }
  }
  if (reasons.size === 0) reasons.add('readers_disagree');
  return [...reasons];
}

/**
 * Política de aceptación asimétrica. Una respuesta correcta acordada se acepta.
 * Para darla por incorrecta se exige más: una selección o una respuesta que el
 * literal del otro lector no sostiene van a revisión, y lo inferido, lo resuelto
 * por desempate o lo que un dígito confundible volvería correcto pasa antes por
 * el verificador.
 */
export function decideAcceptance(input: AcceptanceInput): AcceptanceDecision {
  const { agreement, scoring, verified } = input;
  if (agreement === null) return { action: 'review', reasons: reasonsWithoutAgreement(verified) };
  if (agreement.kind === 'blank') {
    return agreement.blankEvidence === 'ink_absent'
      ? { action: 'accept_blank' }
      : { action: 'review', reasons: ['blank_unverified'] };
  }
  if (scoring === null || scoring === 'undecidable') {
    return { action: 'review', reasons: ['undecidable'] };
  }
  if (scoring === 'correct') return { action: 'accept' };
  if (agreement.strength === 'selection') {
    return { action: 'review', reasons: ['selection_incorrect'] };
  }
  if (agreement.crossSupport === 'unsupported') {
    return { action: 'review', reasons: ['answer_not_derivable'] };
  }
  const because: VerifyIncorrectCause[] = [];
  if (input.confusableFlipsToCorrect === true) because.push('doubtful_digit');
  if (agreement.strength === 'inferred') because.push('inferred');
  if (agreement.via === 'tiebreak') because.push('tiebreak');
  return because.length > 0 ? { action: 'verify_incorrect', because } : { action: 'accept' };
}
