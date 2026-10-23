import type { InterpretedReading, ReviewReason, ScoringOutcome } from '@soe/types';
import type {
  AnswerStrength,
  BlankEvidence,
  CrossSupport,
  VerifiedAnswer,
} from './verified-answer';

/**
 * Política de aceptación asimétrica (diseño v5). Corre después de la corrección:
 * dar una respuesta por incorrecta exige más evidencia que darla por correcta,
 * y lo dudoso va a revisión, nunca a 0.
 */
export type AcceptanceAgreement =
  | {
      readonly kind: 'answer';
      readonly canonical: string;
      readonly answerText: string;
      /** Lo resuelto por el desempate cuenta como `inferred` como máximo. */
      readonly via: 'consensus' | 'tiebreak';
      /** La más débil de las lecturas que sostienen el acuerdo. */
      readonly strength: AnswerStrength;
      readonly crossSupport: CrossSupport;
    }
  | { readonly kind: 'blank'; readonly blankEvidence: BlankEvidence };

export interface AcceptanceInput {
  /** Uno por lector primario, en el orden de la ruta. */
  readonly verified: readonly VerifiedAnswer[];
  /** `null`: no hubo acuerdo ni desempate válido. */
  readonly agreement: AcceptanceAgreement | null;
  /** Resultado de corregir `agreement.answerText`; `null` si no se corrigió. */
  readonly scoring: ScoringOutcome | null;
  readonly readings: readonly InterpretedReading[];
  /**
   * `true` si alguna variante de `confusableDigitVariants(agreement.answerText)`
   * resulta correcta: el «1» chileno leído como 7 o 4 le estaría quitando el
   * punto al alumno. Lo calcula quien corrige, con la clave.
   */
  readonly confusableFlipsToCorrect?: boolean;
}

export type AcceptanceDecision =
  | { readonly action: 'accept' }
  | { readonly action: 'accept_blank' }
  /** Pasa por verify.incorrect@1: si lo aprueba se acepta; si no, revisión. */
  | { readonly action: 'verify_incorrect'; readonly because: readonly VerifyIncorrectCause[] }
  | { readonly action: 'review'; readonly reasons: readonly ReviewReason[] };

export type VerifyIncorrectCause = 'doubtful_digit' | 'inferred' | 'tiebreak';

export type DecideAcceptance = (input: AcceptanceInput) => AcceptanceDecision;
