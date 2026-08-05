// Estrategia determinística para `rubric_scored`: el ítem NO tiene respuesta
// correcta. Lo que llega es el código del nivel que le asignó quien corrigió, y
// la estrategia sólo lo convierte en puntaje según la escala declarada en el ítem.
//
// `isCorrect` mantiene la convención del resto del registro —"obtuvo el puntaje
// máximo"— para no partir la semántica en dos: `aggregateStudentResults` usa
// `isCorrect !== null` como compuerta de "está corregido", así que devolver null
// en un nivel válido borraría el puntaje del total del alumno.
//
// Un código NO declarado (una marca doble del escáner, texto libre) queda
// pendiente, nunca en 0: una lectura fallida no es un cero.
import type { RubricLevel, RubricScoredContent } from '../../schemas/item-content.schema';
import type { ScoringInput, ScoringOutput, ScoringStrategy } from '../scoring-strategy';
import { asTrimmedString } from './scoring.helpers';

const PENDING: ScoringOutput = { isCorrect: null, rawScore: null, requiresManualGrading: true };

function findLevel(levels: readonly RubricLevel[], code: string): RubricLevel | undefined {
  const normalized = code.trim().toLocaleLowerCase('es');
  return levels.find((level) => level.code.trim().toLocaleLowerCase('es') === normalized);
}

export const rubricScoredStrategy: ScoringStrategy = {
  score(input: ScoringInput): ScoringOutput {
    const content = input.item.content as RubricScoredContent;
    const code = asTrimmedString(input.rawAnswer);
    if (code === null || code.length === 0) return PENDING;

    const level = findLevel(content.levels ?? [], code);
    if (!level) return PENDING;

    const rawScore = level.creditFraction * input.item.maxScore;
    return {
      isCorrect: level.creditFraction >= 1,
      rawScore,
      requiresManualGrading: false,
    };
  },
};
