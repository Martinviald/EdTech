// Estrategia determinística para `short_answer`: el alumno escribe un valor y se
// compara contra las claves de la pauta con tolerancia de forma (ver
// `utils/short-answer`). Corrección binaria: acierta o no.
//
// Una respuesta INDECIDIBLE (trae más de un valor candidato) no se puntúa 0: se
// deja pendiente. Castigar una ambigüedad de digitalización sería inventar un
// dato en contra del alumno.
import { matchesAcceptedAnswer } from '../../utils/short-answer';
import type { ShortAnswerContent } from '../../schemas/item-content.schema';
import type { ScoringInput, ScoringOutput, ScoringStrategy } from '../scoring-strategy';
import { asTrimmedString } from './scoring.helpers';

export const shortAnswerStrategy: ScoringStrategy = {
  score(input: ScoringInput): ScoringOutput {
    const content = input.item.content as ShortAnswerContent;
    const answer = asTrimmedString(input.rawAnswer);

    if (answer === null || answer.length === 0) {
      return { isCorrect: false, rawScore: 0, requiresManualGrading: false };
    }

    const result = matchesAcceptedAnswer(answer, content.acceptedAnswers ?? [], {
      comparison: content.comparison,
      unit: content.unit,
      caseSensitive: content.caseSensitive,
    });

    if (result === 'undecidable') {
      return { isCorrect: null, rawScore: null, requiresManualGrading: true };
    }

    const isCorrect = result === 'match';
    return {
      isCorrect,
      rawScore: isCorrect ? input.item.maxScore : 0,
      requiresManualGrading: false,
    };
  },
};
