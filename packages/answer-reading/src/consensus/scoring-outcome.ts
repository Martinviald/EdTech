import type { ScoringOutcome, ScoringOutput } from '@soe/types';

/** Traduce la salida de una estrategia de corrección al resultado que usa el consenso. */
export function toScoringOutcome(output: ScoringOutput): ScoringOutcome {
  if (output.requiresManualGrading || output.isCorrect === null) return 'undecidable';
  if (output.isCorrect) return 'correct';
  return (output.rawScore ?? 0) > 0 ? 'partial' : 'incorrect';
}
