/**
 * Métricas psicométricas deterministas para el snapshot del análisis IA (H20.1).
 *
 * Funciones PURAS (sin DB, sin estado): reciben la matriz de aciertos
 * correcto/incorrecto del instrumento y devuelven números reproducibles. La IA
 * razona sobre estos valores; nunca los calcula. Ningún dato aquí es PII: la
 * matriz es booleana por (alumno × ítem), sin identidades.
 */

/**
 * Matriz de respuestas correctas/incorrectas de un instrumento de selección
 * múltiple. `matrix[s][i]` = true si el alumno `s` acertó el ítem `i`. Un blanco
 * cuenta como incorrecto (false). Todas las filas tienen el mismo largo
 * (`itemCount`); las posiciones de ítem son estables entre filas.
 */
export type ScoreMatrix = boolean[][];

/** Convierte un booleano de acierto a 1/0 (puntaje dicotómico). */
function toScore(correct: boolean): number {
  return correct ? 1 : 0;
}

/** Promedio simple; 0 si el arreglo está vacío (evita NaN). */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Desviación estándar poblacional; 0 si hay menos de 1 valor. */
function populationStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  const variance = mean(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}

/**
 * KR-20 (Kuder-Richardson 20): confiabilidad de consistencia interna para ítems
 * dicotómicos (correcto/incorrecto).
 *
 *   KR-20 = (k / (k − 1)) * (1 − Σ(p_i * q_i) / σ²_total)
 *
 * donde k = nº de ítems, p_i = proporción de aciertos del ítem i, q_i = 1 − p_i,
 * y σ²_total = varianza de los puntajes totales por alumno.
 *
 * Devuelve `null` (no calculable) si k < 2 o no hay alumnos o la varianza total
 * es 0 (todos los puntajes iguales → confiabilidad indefinida). El valor teórico
 * cae en (−∞, 1]; valores típicos 0..1.
 */
export function kr20(matrix: ScoreMatrix): number | null {
  const students = matrix.length;
  if (students === 0) return null;

  const k = matrix[0]?.length ?? 0;
  if (k < 2) return null;

  // Puntaje total por alumno.
  const totals = matrix.map((row) => row.reduce((sum, c) => sum + toScore(c), 0));
  const totalVariance = populationStdDev(totals) ** 2;
  if (totalVariance === 0) return null;

  // Σ p_i * q_i sobre los ítems (varianza de cada ítem dicotómico).
  let sumPq = 0;
  for (let i = 0; i < k; i++) {
    let correct = 0;
    for (let s = 0; s < students; s++) {
      if (matrix[s]?.[i]) correct++;
    }
    const p = correct / students;
    sumPq += p * (1 - p);
  }

  return (k / (k - 1)) * (1 - sumPq / totalVariance);
}

/**
 * Correlación punto-biserial de un ítem: discriminación fina = correlación de
 * Pearson entre el acierto dicotómico del ítem (1/0) y el puntaje total del
 * alumno en el instrumento.
 *
 *   r_pb = (M+ − M−) / σ_total * sqrt(p * q)
 *
 * donde M+ = media de puntajes totales de quienes acertaron, M− = media de
 * quienes fallaron, σ_total = desviación estándar de los puntajes totales,
 * p = proporción de aciertos, q = 1 − p.
 *
 * Para evitar contaminación (el ítem se incluye en su propio total), se usa el
 * "corrected item-total": el total se calcula EXCLUYENDO el ítem evaluado.
 *
 * Devuelve `null` si no hay alumnos, si el ítem no varía (todos aciertan o todos
 * fallan) o si la varianza del total corregido es 0. Rango [−1, 1].
 */
export function pointBiserial(matrix: ScoreMatrix, itemIndex: number): number | null {
  const students = matrix.length;
  if (students === 0) return null;

  const k = matrix[0]?.length ?? 0;
  if (itemIndex < 0 || itemIndex >= k) return null;

  // Total corregido: suma de todos los ítems menos el evaluado.
  const correctedTotals: number[] = [];
  const itemScores: number[] = [];
  for (let s = 0; s < students; s++) {
    const row = matrix[s] ?? [];
    let total = 0;
    for (let i = 0; i < k; i++) {
      if (i === itemIndex) continue;
      total += toScore(row[i] ?? false);
    }
    correctedTotals.push(total);
    itemScores.push(toScore(row[itemIndex] ?? false));
  }

  const correctTotals = correctedTotals.filter((_, s) => itemScores[s] === 1);
  const incorrectTotals = correctedTotals.filter((_, s) => itemScores[s] === 0);

  // Sin varianza en el ítem (todos aciertan o todos fallan) → indefinido.
  if (correctTotals.length === 0 || incorrectTotals.length === 0) return null;

  const sigma = populationStdDev(correctedTotals);
  if (sigma === 0) return null;

  const p = correctTotals.length / students;
  const q = 1 - p;
  const meanPlus = mean(correctTotals);
  const meanMinus = mean(incorrectTotals);

  return ((meanPlus - meanMinus) / sigma) * Math.sqrt(p * q);
}
