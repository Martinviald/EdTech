// Estrategia determinística para `gap_fill`. Cada gap tiene `acceptedAnswers`
// (lista de respuestas válidas) y un flag opcional `caseSensitive`. Corrección
// "todo o nada": el alumno acierta el ítem solo si TODOS los gaps son correctos.
//
// La respuesta del alumno puede venir como:
//   - array ordenado por posición de gap: ["casa", "perro"]
//   - record por posición: { "0": "casa", "1": "perro" }

import type { GapFillContent } from '@soe/types';
import type { ScoringInput, ScoringOutput, ScoringStrategy } from '../scoring-strategy';
import { asRecord, asStringArray, normalizeAnswer } from './scoring.helpers';

/** Devuelve la respuesta del alumno para el gap en `position`, o null. */
function answerForGap(raw: unknown, position: number, index: number): string | null {
  const arr = asStringArray(raw);
  if (arr) return arr[index] ?? null;
  const record = asRecord(raw);
  if (record) {
    const byPosition = record[String(position)];
    if (typeof byPosition === 'string') return byPosition;
    const byIndex = record[String(index)];
    if (typeof byIndex === 'string') return byIndex;
  }
  return null;
}

export const gapFillStrategy: ScoringStrategy = {
  score(input: ScoringInput): ScoringOutput {
    const content = input.item.content as GapFillContent;
    const gaps = content.gaps ?? [];

    const incorrect: ScoringOutput = {
      isCorrect: false,
      rawScore: 0,
      requiresManualGrading: false,
    };

    if (gaps.length === 0) return incorrect;

    const allCorrect = gaps.every((gap, index) => {
      const studentAnswer = answerForGap(input.rawAnswer, gap.position, index);
      if (studentAnswer === null) return false;
      const caseSensitive = gap.caseSensitive === true;
      const normalizedStudent = normalizeAnswer(studentAnswer, caseSensitive);
      return gap.acceptedAnswers.some(
        (accepted) => normalizeAnswer(accepted, caseSensitive) === normalizedStudent,
      );
    });

    return allCorrect
      ? { isCorrect: true, rawScore: input.item.maxScore, requiresManualGrading: false }
      : incorrect;
  },
};
