// Estrategia determinística para `multi_select`: el alumno marca VARIAS opciones
// y hay que comparar conjuntos, no una letra contra otra.
//
// Es un tipo propio y no una variante de `multiple_choice` porque lo que cambia
// es la semántica de corrección, y el `type` es lo que elige la estrategia. Con
// la clave derivada de la PRIMERA alternativa correcta —lo que hacía la
// estrategia MCQ— estos ítems puntuaban al revés: el que marcaba la respuesta
// completa sacaba 0 y el que marcaba una sola sacaba 1.
//
// La política es configuración:
//
//   requireExact (default) → rawScore = (marcadas === correctas) ? points : 0
//   si no                  → rawScore = pointsPerCorrect × aciertos
//                                       − penaltyPerIncorrect × errores, en [0, points]
//
// El default reproduce a la Agencia: verificado contra el escaneo real, dio 0 a
// una respuesta parcial y 1 a la exacta, con max_points 1.

import {
  correctKeysOf,
  parseSelectedKeys,
  sameKeySet,
  type MultiSelectContent,
  type MultiSelectScoring,
} from '@soe/types';
import type { ScoringInput, ScoringOutput, ScoringStrategy } from '../scoring-strategy';

function resolveScoringPolicy(input: ScoringInput): {
  requireExact: boolean;
  pointsPerCorrect: number | undefined;
  penaltyPerIncorrect: number;
} {
  const config = input.item.scoringConfig as { multiSelect?: MultiSelectScoring } | undefined;
  return {
    requireExact: config?.multiSelect?.requireExact !== false,
    pointsPerCorrect: config?.multiSelect?.pointsPerCorrect,
    penaltyPerIncorrect: config?.multiSelect?.penaltyPerIncorrect ?? 0,
  };
}

export const multiSelectStrategy: ScoringStrategy = {
  score(input: ScoringInput): ScoringOutput {
    const content = input.item.content as MultiSelectContent;
    const alternatives = content.alternatives ?? [];
    const maxScore = input.item.maxScore;
    const incorrect: ScoringOutput = {
      isCorrect: false,
      rawScore: 0,
      requiresManualGrading: false,
    };

    const correct = correctKeysOf(alternatives);
    if (correct.size === 0) return incorrect;

    // `null` = la respuesta no se puede interpretar sin adivinar (ver
    // parseSelectedKeys). Se puntúa 0, nunca se inventa una selección.
    const selected = parseSelectedKeys(
      input.rawAnswer,
      alternatives.map((alt) => alt.key),
    );
    if (selected === null) return incorrect;

    const exact = sameKeySet(selected, correct);
    const { requireExact, pointsPerCorrect, penaltyPerIncorrect } = resolveScoringPolicy(input);

    if (requireExact) {
      return {
        isCorrect: exact,
        rawScore: exact ? maxScore : 0,
        requiresManualGrading: false,
      };
    }

    let hits = 0;
    for (const key of selected) if (correct.has(key)) hits++;
    const misses = selected.size - hits;

    const perCorrect = pointsPerCorrect ?? maxScore / correct.size;
    const earned = perCorrect * hits - penaltyPerIncorrect * misses;

    return {
      isCorrect: exact,
      rawScore: Math.min(Math.max(earned, 0), maxScore),
      requiresManualGrading: false,
    };
  },
};
