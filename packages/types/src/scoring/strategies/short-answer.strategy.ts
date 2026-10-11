// Estrategia determinística para `short_answer`: el alumno escribe un valor y se
// compara contra las claves de la pauta con tolerancia de forma (ver
// `utils/short-answer`). Corrección binaria salvo un caso: un par ordenado cuya
// pauta declara `componentCredit` da crédito por coordenada (diseño §10.1, D6).
// `partialCredit: false` lo apaga explícitamente.
//
// Una respuesta INDECIDIBLE (trae más de un valor candidato, o admite dos lecturas
// con resultados distintos) no se puntúa 0: se deja pendiente. Castigar una
// ambigüedad de digitalización sería inventar un dato en contra del alumno.
import { creditForAcceptedAnswer } from '../../utils/short-answer';
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

    const config = input.item.scoringConfig;
    const result = creditForAcceptedAnswer(answer, content.acceptedAnswers ?? [], {
      comparison: content.comparison,
      unit: content.unit,
      caseSensitive: content.caseSensitive,
      formatKind: content.responseFormat?.kind,
      equivalences: config?.equivalences,
      componentCredit: config?.partialCredit === false ? undefined : config?.componentCredit,
    });

    if (result.outcome === 'undecidable') {
      return { isCorrect: null, rawScore: null, requiresManualGrading: true };
    }

    const maxScore = input.item.maxScore;
    if (result.outcome === 'partial') {
      return { isCorrect: false, rawScore: maxScore * result.credit, requiresManualGrading: false };
    }

    const isCorrect = result.outcome === 'correct';
    return {
      isCorrect,
      rawScore: isCorrect ? maxScore : 0,
      requiresManualGrading: false,
    };
  },
};
