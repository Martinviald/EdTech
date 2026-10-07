import type { ProcessCoverageResponse } from '@soe/types';

/** Presentación compartida por el titular por nivel y la matriz del proceso. */

export const NEUTRAL_BAND = '#94a3b8';

export function pct(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} %`;
}

/**
 * El denominador del titular: celdas cargadas sobre celdas esperadas, o `null`
 * cuando no existe.
 *
 * Devuelve `null` en tres casos distintos, y los tres son lo mismo para el
 * lector —no hay denominador que mostrar—:
 *
 * - **alcance docente**: el de `/coverage` es el del colegio entero, así que
 *   contra un numerador ya recortado daría siempre un cociente bajo el piso;
 * - **sin cobertura**: el proceso no declaró alcance (`/coverage` responde 200
 *   con `expected: 0`) o la request falló. Antes se caía a contar las celdas del
 *   rollup, y como sin cobertura TODAS nacen de unidades, eso daba
 *   `loaded === expected` siempre: un proceso al 34 % se leía como completo;
 * - **sin `expected`**: mismo caso, por la vía del `0`.
 */
export function coverageSummaryOf(
  coverage: ProcessCoverageResponse | null,
  orgScoped: boolean,
): { loadedCells: number; expectedCells: number } | null {
  if (!orgScoped || !coverage || coverage.totals.expected === 0) return null;
  return { loadedCells: coverage.totals.complete, expectedCells: coverage.totals.expected };
}

/**
 * ¿Se puede cruzar `/coverage` con este numerador?
 *
 * `/measurement-processes/:id/coverage` no acepta filtros ni recorta por alcance
 * docente: su denominador es siempre el del proceso completo en el colegio
 * entero. Cruzarlo con un numerador recortado hunde el cociente bajo el piso del
 * titular (`isHeadlineTrustworthy`) y deja las celdas de lo filtrado marcadas
 * como si no tuvieran niveles cargados.
 *
 * Es el gate de A1/D4 y el riesgo que el plan declara mitigado: si se pierde, un
 * profesor ve el denominador del colegio.
 */
export function processCoverageApplies({
  orgScoped,
  narrowedByFilters,
}: {
  orgScoped: boolean;
  narrowedByFilters: boolean;
}): boolean {
  return orgScoped && !narrowedByFilters;
}
