// Cómo se presenta el resultado de UNA respuesta en la UI.
//
// Vive acá porque la matriz alumno×pregunta y el informe del alumno lo derivaban
// cada uno por su cuenta y con predicados DISTINTOS (`isCorrect === false` vs
// `isCorrect === null`): un `matching` parcial se veía ámbar "3/4" en una pantalla
// y rojo "✗" en la otra, para el mismo alumno y la misma respuesta.

/** Estado presentable de una respuesta. */
export type ResponseOutcome = 'correct' | 'partial' | 'incorrect' | 'ungraded' | 'unanswered';

export type ResponseOutcomeInput = {
  isCorrect: boolean | null;
  score: number | null;
  maxScore: number | null;
  hasAnswer: boolean;
};

/**
 * `isCorrect === null` significa "sin corregir", no "incorrecta": un ítem que
 * espera corrección nunca debe pintarse como error. El parcial se reconoce por el
 * puntaje —estrictamente entre 0 y el máximo—, no por el booleano, porque un ítem
 * evaluado por pauta no tiene respuesta correcta contra la cual comparar.
 */
export function responseOutcome(r: ResponseOutcomeInput): ResponseOutcome {
  if (r.isCorrect === null) return r.hasAnswer ? 'ungraded' : 'unanswered';
  if (r.isCorrect) return 'correct';
  if (r.score !== null && r.maxScore !== null && r.score > 0 && r.score < r.maxScore) {
    return 'partial';
  }
  return r.hasAnswer ? 'incorrect' : 'unanswered';
}
