import type { ProcessCoverageResponse, ProcessResultsRollup } from '@soe/types';

/** Presentación compartida por el titular por nivel y la matriz del proceso. */

export const NEUTRAL_BAND = '#94a3b8';

export function pct(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} %`;
}

/**
 * El denominador del titular: celdas cargadas sobre celdas esperadas.
 *
 * `null` con alcance docente, y es deliberado: el denominador de `/coverage` es
 * el del colegio entero, así que compararlo contra un numerador ya recortado
 * daría siempre un cociente bajo el piso y el profesor no vería nunca el
 * titular. Sin cobertura declarada se cuentan las celdas que ya tienen unidad,
 * que es lo único medible.
 */
export function coverageSummaryOf(
  rollup: ProcessResultsRollup,
  coverage: ProcessCoverageResponse | null,
  orgScoped: boolean,
): { loadedCells: number; expectedCells: number } | null {
  if (!orgScoped) return null;
  if (coverage) {
    return { loadedCells: coverage.totals.complete, expectedCells: coverage.totals.expected };
  }
  return {
    loadedCells: rollup.matrix.cells.filter((c) => c.unitKeys.length > 0).length,
    expectedCells: rollup.matrix.cells.length,
  };
}
