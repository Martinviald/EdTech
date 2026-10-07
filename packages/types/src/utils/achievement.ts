/**
 * % de logro de un grupo (docs/diseno-logro-unificado-y-cohorte.md §3.1): Σ puntaje obtenido ÷
 * Σ puntaje máximo, sobre las respuestas registradas y ya corregidas de las preguntas que cada
 * alumno rindió.
 *
 * Es la única forma de calcular el logro de un grupo (curso, nivel, colegio, muestra; prueba,
 * sección, nodo o pregunta). Los grupos se combinan SUMANDO tallies, nunca promediando
 * porcentajes: un porcentaje no se puede combinar sin conocer su peso.
 *
 * Contrato congelado entre sesiones (coordinacion/acuerdos.md §2): no cambia de forma. Lo que haga
 * falta se agrega como función nueva.
 */
export type AchievementTally = { scoreSum: number; maxSum: number };

/** Fila con puntajes tal como llegan de la base: los `decimal` de Postgres vienen como string. */
export type AchievementTallyRow = {
  scoreSum: number | string | null;
  maxSum: number | string | null;
};

export function emptyTally(): AchievementTally {
  return { scoreSum: 0, maxSum: 0 };
}

/** Suma `source` en `target` (lo muta): así se combinan cursos, ítems o colegios sin copiar. */
export function addTally(target: AchievementTally, source: AchievementTally): void {
  target.scoreSum += source.scoreSum;
  target.maxSum += source.maxSum;
}

function toFiniteNumber(value: number | string | null): number {
  if (value === null) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Tally de varias filas. `null`, vacío o no numérico cuenta 0. */
export function tallyOf(rows: Iterable<AchievementTallyRow>): AchievementTally {
  const tally = emptyTally();
  for (const row of rows) {
    tally.scoreSum += toFiniteNumber(row.scoreSum);
    tally.maxSum += toFiniteNumber(row.maxSum);
  }
  return tally;
}

/**
 * % de logro (0..100) SIN redondear; `null` si no hay puntaje corregido (`maxSum <= 0`), nunca 0.
 * Se redondea sólo al mostrar o al persistir (`round2`).
 */
export function achievementPct(tally: AchievementTally): number | null {
  if (!(tally.maxSum > 0)) return null;
  return (tally.scoreSum / tally.maxSum) * 100;
}
