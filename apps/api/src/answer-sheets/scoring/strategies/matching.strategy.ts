// Estrategia determinística para `matching`. Corrección "todo o nada": la
// respuesta del alumno (mapa leftId → rightId, o array de pares) debe reproducir
// EXACTAMENTE `content.correctPairs`. Sin respuesta → incorrecto (score 0), nunca
// pendiente: matching ES auto-scorable.

import type { MatchingContent } from '@soe/types';
import type { ScoringInput, ScoringOutput, ScoringStrategy } from '../scoring-strategy';
import { asRecord } from './scoring.helpers';

/** Normaliza la respuesta del alumno a un mapa leftId → rightId. */
function parseStudentPairs(raw: unknown): Map<string, string> | null {
  // Forma 1: objeto/record { leftId: rightId }.
  const record = asRecord(raw);
  if (record) {
    const map = new Map<string, string>();
    for (const [leftId, rightId] of Object.entries(record)) {
      if (typeof rightId !== 'string') return null;
      map.set(leftId, rightId);
    }
    return map;
  }
  // Forma 2: array de pares [{ leftId, rightId }].
  if (Array.isArray(raw)) {
    const map = new Map<string, string>();
    for (const pair of raw) {
      if (pair === null || typeof pair !== 'object') return null;
      const leftId = (pair as { leftId?: unknown }).leftId;
      const rightId = (pair as { rightId?: unknown }).rightId;
      if (typeof leftId !== 'string' || typeof rightId !== 'string') return null;
      map.set(leftId, rightId);
    }
    return map;
  }
  return null;
}

export const matchingStrategy: ScoringStrategy = {
  score(input: ScoringInput): ScoringOutput {
    const content = input.item.content as MatchingContent;
    const correctPairs = content.correctPairs ?? [];
    const studentPairs = parseStudentPairs(input.rawAnswer);

    const incorrect: ScoringOutput = {
      isCorrect: false,
      rawScore: 0,
      requiresManualGrading: false,
    };

    if (!studentPairs) return incorrect;
    if (studentPairs.size !== correctPairs.length) return incorrect;

    const allMatch = correctPairs.every((p) => studentPairs.get(p.leftId) === p.rightId);
    return allMatch
      ? { isCorrect: true, rawScore: input.item.maxScore, requiresManualGrading: false }
      : incorrect;
  },
};
