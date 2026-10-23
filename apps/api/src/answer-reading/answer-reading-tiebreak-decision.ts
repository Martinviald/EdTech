import {
  tiebreakAnswerKind,
  type TiebreakCandidate,
  type TiebreakChoice,
} from '@soe/answer-reading';
import { choice, type ChoiceAnswer, type ChoiceQuestion, type DecisionState } from '@soe/decisions';
import type { AnswerSpace, ResponseFormat } from '@soe/types';

export const ANSWER_READING_TIEBREAK_QUESTION_ID = 'respuesta';
export const ANSWER_READING_TIEBREAK_BLANK = 'en_blanco';
export const ANSWER_READING_TIEBREAK_OTHER = 'otra';

export type AnswerReadingTiebreakQuestions = {
  readonly [ANSWER_READING_TIEBREAK_QUESTION_ID]: ChoiceQuestion<string>;
};

export interface AnswerReadingTiebreakDecision {
  readonly state: DecisionState;
  readonly questions: AnswerReadingTiebreakQuestions;
  readonly candidateByKey: ReadonlyMap<string, string>;
}

export interface AnswerReadingTiebreakContext {
  readonly gradeName: string | null;
  readonly format: ResponseFormat;
  readonly space: AnswerSpace | null;
}

function cropDescription(gradeName: string | null): string {
  return (
    'La imagen es el recorte de UNA casilla de una hoja de respuestas en papel donde un alumno de ' +
    `${gradeName ?? 'enseñanza básica'} en Chile escribió a mano su respuesta. ` +
    'Mira solo lo escrito a mano dentro de la casilla; las líneas punteadas y los bordes impresos no son respuesta. ' +
    'En la escritura chilena el 1 suele llevar un rasgo inicial largo y el 7 lleva una barra horizontal.'
  );
}

export function buildAnswerReadingTiebreakDecision(
  candidates: readonly TiebreakCandidate[],
  context: AnswerReadingTiebreakContext,
): AnswerReadingTiebreakDecision {
  const criteria: Record<string, string> = {};
  const candidateByKey = new Map<string, string>();
  candidates.forEach((candidate, index) => {
    const key = `c${index + 1}`;
    criteria[key] =
      `La respuesta final que escribió el alumno es «${candidate.text}». Puede estar escrita con otro formato, ` +
      'o con palabras, unidades o cálculos alrededor, pero el valor que el alumno dio como respuesta es exactamente ese.';
    candidateByKey.set(key, candidate.text);
  });
  criteria[ANSWER_READING_TIEBREAK_BLANK] = 'La casilla está vacía: no hay nada escrito a mano.';
  criteria[ANSWER_READING_TIEBREAK_OTHER] =
    candidates.length > 0
      ? 'El alumno escribió otra respuesta distinta de las anteriores, varias respuestas, o algo ilegible.'
      : 'Hay algo escrito a mano en la casilla.';
  return {
    state: {
      descripcion: `${cropDescription(context.gradeName)} Tipo de respuesta esperada: ${tiebreakAnswerKind(context.format, context.space)}.`,
    },
    questions: {
      [ANSWER_READING_TIEBREAK_QUESTION_ID]: choice(
        'Siguiendo `descripcion` y mirando la imagen, ¿qué respondió el alumno en esta casilla?',
        criteria,
      ),
    },
    candidateByKey,
  };
}

export function tiebreakChoiceOf(
  decision: Pick<AnswerReadingTiebreakDecision, 'candidateByKey'>,
  answer: Pick<ChoiceAnswer<string>, 'choice' | 'confidence'>,
): TiebreakChoice {
  if (answer.choice === ANSWER_READING_TIEBREAK_BLANK) {
    return { kind: 'blank', confidence: answer.confidence };
  }
  const text = decision.candidateByKey.get(answer.choice);
  return text === undefined
    ? { kind: 'other', confidence: answer.confidence }
    : { kind: 'candidate', text, confidence: answer.confidence };
}
