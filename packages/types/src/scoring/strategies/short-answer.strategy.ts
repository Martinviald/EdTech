// Estrategia determinística para `short_answer`: el alumno escribe un valor y se
// compara contra las claves de la pauta con tolerancia de forma (ver
// `utils/short-answer`). Corrección binaria salvo cuando la pauta declara
// `componentCredit`: un par ordenado da crédito por coordenada y una lista de
// palabras por palabra (diseño §10.1, D6). `partialCredit: false` lo apaga.
//
// Un formato declarado `word_list` o `short_text` fija cómo se compara, por
// encima de la comparación genérica `text`: un texto corto que no calza exacto
// va a revisión, nunca a incorrecta.
//
// Una respuesta INDECIDIBLE (trae más de un valor candidato, o admite dos lecturas
// con resultados distintos) no se puntúa 0: se deja pendiente. Castigar una
// ambigüedad de digitalización sería inventar un dato en contra del alumno.
import { comparisonForFormat, creditForAcceptedAnswer } from '../../utils/short-answer';
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
    const byFormat = comparisonForFormat(content.responseFormat?.kind);
    const textFormat = byFormat === 'word_list' || byFormat === 'short_text';
    const comparison =
      textFormat && (content.comparison === undefined || content.comparison === 'text')
        ? byFormat
        : (content.comparison ?? byFormat);
    const result = creditForAcceptedAnswer(answer, content.acceptedAnswers ?? [], {
      comparison,
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
