import { choice, type ChoiceQuestion, type DecisionState } from '@soe/decisions';
import {
  MARK_ANSWER_BLANK,
  MARK_ANSWER_NULL,
  MARK_DISAMBIGUATION_QUESTION_ID,
  type LayoutField,
} from '@soe/types';

export {
  MARK_ANSWER_BLANK,
  MARK_ANSWER_NULL,
  MARK_DISAMBIGUATION_DECISION_VERSION,
  MARK_DISAMBIGUATION_QUESTION_ID,
} from '@soe/types';

export type MarkDisambiguationQuestions = {
  readonly [MARK_DISAMBIGUATION_QUESTION_ID]: ChoiceQuestion<string>;
};

export interface MarkDisambiguationDecision {
  state: DecisionState;
  questions: MarkDisambiguationQuestions;
}

const RESERVED_ANSWERS: ReadonlySet<string> = new Set([MARK_ANSWER_BLANK, MARK_ANSWER_NULL]);

export function markDisambiguationOptions(field: Pick<LayoutField, 'bubbles'>): string[] {
  return [...field.bubbles]
    .sort((left, right) => left.center.x - right.center.x)
    .map((bubble) => bubble.value);
}

export function collidesWithReservedAnswers(options: readonly string[]): boolean {
  return options.some((option) => RESERVED_ANSWERS.has(option));
}

export function markDisambiguationChoiceKeys(options: readonly string[]): string[] {
  return [...options, MARK_ANSWER_BLANK, MARK_ANSWER_NULL];
}

export function buildMarkDisambiguationDecision(
  options: readonly string[],
): MarkDisambiguationDecision {
  if (options.length === 0) {
    throw new Error('La pregunta de alternativas necesita al menos una burbuja.');
  }
  if (collidesWithReservedAnswers(options)) {
    throw new Error(
      `Los rótulos del campo chocan con las respuestas reservadas "${MARK_ANSWER_BLANK}" o "${MARK_ANSWER_NULL}".`,
    );
  }
  const labels = options.join(', ');
  const descripcion =
    'La imagen es el recorte de UNA pregunta de alternativas de una hoja de respuestas en papel. ' +
    `Muestra una fila de burbujas impresas con los rótulos ${labels}, de izquierda a derecha. ` +
    'Puede asomar el borde de la fila de arriba o de abajo: ignóralo, evalúa solo la fila central completa. ' +
    'Un alumno marca su respuesta rellenando una burbuja con lápiz. Los rótulos impresos y el contorno ' +
    'de cada burbuja NO son marcas. ¿Qué respondió el alumno en esta pregunta?';

  const criteria: Record<string, string> = {};
  for (const option of options) {
    criteria[option] = `Rellenó claramente la burbuja ${option} y ninguna otra.`;
  }
  criteria[MARK_ANSWER_BLANK] =
    'No rellenó ninguna burbuja: todas están vacías (solo contorno y rótulo impreso).';
  criteria[MARK_ANSWER_NULL] =
    'Respuesta nula: rellenó dos o más burbujas, o hay marcas que no permiten saber cuál eligió ' +
    '(borrones, tachas, rellenos parciales parecidos en varias burbujas).';

  return {
    state: { descripcion },
    questions: {
      [MARK_DISAMBIGUATION_QUESTION_ID]: choice(
        'Siguiendo `descripcion` y mirando la imagen del recorte, ¿qué respondió el alumno en esta pregunta?',
        criteria,
      ),
    },
  };
}
