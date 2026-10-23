import type { AnswerSpace, InterpretedReading, ResponseFormat } from '@soe/types';

/**
 * Contrato de la verificación de respuestas interpretadas (diseño v5). La
 * verificación no ve la clave: decide si la respuesta que propone un lector
 * existe en el ítem y se desprende de lo escrito. La clave recién entra en la
 * política de aceptación, después de la corrección.
 */
export interface AnswerVerificationInput {
  readonly reading: InterpretedReading;
  /** Lectura del otro lector: su literal es la evidencia independiente. */
  readonly otherReading?: InterpretedReading | null;
  readonly format: ResponseFormat;
  readonly space: AnswerSpace;
  /** Evidencia de tinta del recorte, si la capa de tinta la calculó. */
  readonly ink?: InkEvidence | null;
}

export interface InkEvidence {
  readonly hasInk: boolean;
}

export const VERIFIED_ANSWER_STATUSES = [
  'unique',
  'ambiguous',
  'out_of_space',
  'not_derivable',
  'blank',
  'unreadable',
  'not_applicable',
] as const;
export type VerifiedAnswerStatus = (typeof VERIFIED_ANSWER_STATUSES)[number];

/**
 * `direct`: solo cambió la forma. `inferred`: hubo interpretación (palabras
 * quitadas, glifo, texto de opción). `selection`: el literal traía otro valor
 * válido y el lector lo descartó.
 */
export type AnswerStrength = 'direct' | 'inferred' | 'selection';

/** Si la respuesta se desprende del literal del OTRO lector. */
export type CrossSupport = 'supported' | 'unsupported' | 'no_other';

/** Solo `ink_absent` permite aceptar un blanco. */
export type BlankEvidence = 'ink_absent' | 'unverified';

export const ANSWER_VERIFICATION_RULES = [
  'identity',
  'whitespace_punctuation',
  'case',
  'after_last_equals',
  'strip_words_units',
  'collapse_repeats',
  'matching_code',
  'matching_option_text',
  'glyph_confusion',
  'set_tokens',
  'candidate_filter',
] as const;
export type AnswerVerificationRule = (typeof ANSWER_VERIFICATION_RULES)[number];

export interface AnswerVerificationStep {
  readonly rule: AnswerVerificationRule;
  readonly from: string;
  readonly to: string;
}

interface VerifiedBase {
  readonly ruleset: string;
  readonly trace: readonly AnswerVerificationStep[];
}

export type VerifiedAnswer =
  | (VerifiedBase & {
      readonly status: 'unique';
      /** Valor canónico: lo que se compara en el consenso y entra a la corrección. */
      readonly canonical: string;
      readonly strength: AnswerStrength;
      readonly crossSupport: CrossSupport;
    })
  | (VerifiedBase & {
      readonly status: 'ambiguous';
      /** Candidatos canónicos dentro del espacio: la entrada del desempate. */
      readonly candidates: readonly string[];
    })
  | (VerifiedBase & { readonly status: 'blank'; readonly blankEvidence: BlankEvidence })
  | (VerifiedBase & {
      readonly status: 'out_of_space' | 'not_derivable' | 'unreadable' | 'not_applicable';
    });

export type VerifyAnswer = (input: AnswerVerificationInput) => VerifiedAnswer;
