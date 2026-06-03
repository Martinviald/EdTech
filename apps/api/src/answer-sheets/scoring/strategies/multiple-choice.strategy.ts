// Estrategia binaria para `multiple_choice` y `true_false`.
//
// REGRESIÓN CERO (DIA/MCQ): produce exactamente el mismo `isCorrect`/`rawScore`
// que el `===` fijo previo en answer-sheets.service.ts:
//   isCorrect = rawAnswer === null ? false : rawAnswer.toUpperCase() === correctKey.toUpperCase()
//   rawScore  = isCorrect ? maxScore : 0
// La única diferencia es que ahora la clave correcta se deriva del `content`
// tipado (no se descarta) en vez de venir precalculada.

import type {
  MultipleChoiceContent,
  TrueFalseContent,
} from '@soe/types';
import type { ScoringInput, ScoringOutput, ScoringStrategy } from '../scoring-strategy';
import { asTrimmedString } from './scoring.helpers';

/** Extrae la clave correcta de un content MCQ (soporta `correctKey` o `alternatives`). */
function extractMcqCorrectKey(content: MultipleChoiceContent): string {
  const direct = (content as { correctKey?: unknown }).correctKey;
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim().toUpperCase();
  }
  const alternatives = (content as { alternatives?: unknown }).alternatives;
  if (Array.isArray(alternatives)) {
    for (const alt of alternatives) {
      if (
        alt !== null &&
        typeof alt === 'object' &&
        (alt as { isCorrect?: unknown }).isCorrect === true &&
        typeof (alt as { key?: unknown }).key === 'string'
      ) {
        return ((alt as { key: string }).key).trim().toUpperCase();
      }
    }
  }
  return '';
}

function scoreBinary(input: ScoringInput, correctKey: string): ScoringOutput {
  const answer = asTrimmedString(input.rawAnswer);
  const isCorrect = answer === null ? false : answer.toUpperCase() === correctKey.toUpperCase();
  return {
    isCorrect,
    rawScore: isCorrect ? input.item.maxScore : 0,
    requiresManualGrading: false,
  };
}

export const multipleChoiceStrategy: ScoringStrategy = {
  score(input: ScoringInput): ScoringOutput {
    const correctKey = extractMcqCorrectKey(input.item.content as MultipleChoiceContent);
    return scoreBinary(input, correctKey);
  },
};

export const trueFalseStrategy: ScoringStrategy = {
  score(input: ScoringInput): ScoringOutput {
    const content = input.item.content as Partial<TrueFalseContent> & {
      correctKey?: unknown;
      alternatives?: unknown;
    };
    // El content canónico de true_false es `{ correctAnswer: boolean }`. La hoja
    // de respuestas puede traer la respuesta como booleano o como letra
    // (V/F, T/F, A/B). Normalizamos ambos a una clave canónica "TRUE"/"FALSE".
    if (typeof content.correctAnswer === 'boolean') {
      const correctKey = content.correctAnswer ? 'TRUE' : 'FALSE';
      const answer = asTrimmedString(input.rawAnswer);
      const isCorrect = answer === null ? false : booleanKeyOf(answer) === correctKey;
      return {
        isCorrect,
        rawScore: isCorrect ? input.item.maxScore : 0,
        requiresManualGrading: false,
      };
    }
    // Fallback: true_false modelado como MCQ (correctKey/alternatives).
    return scoreBinary(input, extractMcqCorrectKey(content as MultipleChoiceContent));
  },
};

/** Mapea variantes textuales de verdadero/falso a una clave canónica. */
function booleanKeyOf(answer: string): string {
  const a = answer.trim().toUpperCase();
  if (['TRUE', 'T', 'V', 'VERDADERO', 'SI', 'YES', '1', 'A'].includes(a)) return 'TRUE';
  if (['FALSE', 'F', 'FALSO', 'NO', '0', 'B'].includes(a)) return 'FALSE';
  return a; // desconocido → no matcheará ninguna clave canónica
}
