// Estrategia determinística para `ordering`. Corrección "todo o nada": la
// secuencia de ids del alumno debe igualar EXACTAMENTE `content.correctOrder`.

import type { OrderingContent } from '@soe/types';
import type { ScoringInput, ScoringOutput, ScoringStrategy } from '../scoring-strategy';
import { asStringArray } from './scoring.helpers';

export const orderingStrategy: ScoringStrategy = {
  score(input: ScoringInput): ScoringOutput {
    const content = input.item.content as OrderingContent;
    const correctOrder = content.correctOrder ?? [];
    const studentOrder = asStringArray(input.rawAnswer);

    const incorrect: ScoringOutput = {
      isCorrect: false,
      rawScore: 0,
      requiresManualGrading: false,
    };

    if (!studentOrder) return incorrect;
    if (studentOrder.length !== correctOrder.length) return incorrect;

    const allMatch = correctOrder.every((id, i) => studentOrder[i] === id);
    return allMatch
      ? { isCorrect: true, rawScore: input.item.maxScore, requiresManualGrading: false }
      : incorrect;
  },
};
