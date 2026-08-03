// Estrategia determinística para `matching`. La política de puntaje es
// CONFIGURACIÓN, no una constante del tipo:
//
//   partialCredit: false → todo o nada (comportamiento histórico, sin cambios)
//   partialCredit: true  → rawScore = pointsPerPair × correctos
//                                     − penaltyPerIncorrectPair × incorrectos,
//                          acotado a [0, maxScore]
//
// `pointsPerPair` omitido se deriva de `maxScore / nº de pares`, así un ítem que
// sólo declara `points` puntúa bien sin saber cuántos pares tiene. Los pares NO
// respondidos no penalizan: dejar en blanco no es lo mismo que equivocarse.
//
// El alumno responde el lado `leftItems` — ver la invariante en
// `matchingContentSchema` — así que la corrección indexa por `leftId`. Una
// inversión acá corrige mal sin fallar nunca; no cambiar sin leer ese contrato.

import type { MatchingContent, MatchingScoring } from '@soe/types';
import type { ScoringInput, ScoringOutput, ScoringStrategy } from '../scoring-strategy';
import { asRecord } from './scoring.helpers';

/**
 * Normaliza la respuesta del alumno a un mapa leftId → rightId. Acepta un record
 * `{ leftId: rightId }` o un array `[{ leftId, rightId }]`, y tolera respuestas
 * PARCIALES: las entradas inválidas o vacías se descartan una a una en vez de
 * invalidar el ítem completo (con crédito parcial, descartar todo sería un bug).
 */
function parseStudentPairs(raw: unknown): Map<string, string> {
  const pairs = new Map<string, string>();

  const record = asRecord(raw);
  if (record) {
    for (const [leftId, rightId] of Object.entries(record)) {
      if (typeof rightId === 'string' && rightId.trim().length > 0) {
        pairs.set(leftId, rightId.trim());
      }
    }
    return pairs;
  }

  if (Array.isArray(raw)) {
    for (const pair of raw) {
      if (pair === null || typeof pair !== 'object') continue;
      const leftId = (pair as { leftId?: unknown }).leftId;
      const rightId = (pair as { rightId?: unknown }).rightId;
      if (typeof leftId === 'string' && typeof rightId === 'string' && rightId.trim().length > 0) {
        pairs.set(leftId, rightId.trim());
      }
    }
  }

  return pairs;
}

function resolveScoringPolicy(input: ScoringInput): {
  partialCredit: boolean;
  pointsPerPair: number | undefined;
  penaltyPerIncorrectPair: number;
} {
  const config = input.item.scoringConfig as
    | { partialCredit?: boolean; matching?: MatchingScoring }
    | undefined;
  return {
    partialCredit: config?.partialCredit === true,
    pointsPerPair: config?.matching?.pointsPerPair,
    penaltyPerIncorrectPair: config?.matching?.penaltyPerIncorrectPair ?? 0,
  };
}

export const matchingStrategy: ScoringStrategy = {
  score(input: ScoringInput): ScoringOutput {
    const content = input.item.content as MatchingContent;
    const correctPairs = content.correctPairs ?? [];
    const maxScore = input.item.maxScore;

    if (correctPairs.length === 0) {
      return { isCorrect: false, rawScore: 0, requiresManualGrading: false };
    }

    const studentPairs = parseStudentPairs(input.rawAnswer);

    let correctCount = 0;
    let incorrectCount = 0;
    for (const pair of correctPairs) {
      const answered = studentPairs.get(pair.leftId);
      if (answered === undefined) continue;
      if (answered === pair.rightId) correctCount++;
      else incorrectCount++;
    }

    const { partialCredit, pointsPerPair, penaltyPerIncorrectPair } = resolveScoringPolicy(input);
    const allCorrect = correctCount === correctPairs.length;

    if (!partialCredit) {
      return {
        isCorrect: allCorrect,
        rawScore: allCorrect ? maxScore : 0,
        requiresManualGrading: false,
      };
    }

    const perPair = pointsPerPair ?? maxScore / correctPairs.length;
    const earned = perPair * correctCount - penaltyPerIncorrectPair * incorrectCount;
    const rawScore = Math.min(Math.max(earned, 0), maxScore);

    return {
      isCorrect: allCorrect,
      rawScore,
      requiresManualGrading: false,
    };
  },
};
