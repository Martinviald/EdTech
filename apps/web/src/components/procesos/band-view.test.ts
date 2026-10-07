import type { ProcessCoverageResponse, ProcessResultsRollup } from '@soe/types';
import { coverageSummaryOf } from './band-view';

function rollup(cellsWithUnit: number, cellsTotal: number): ProcessResultsRollup {
  const cells = Array.from({ length: cellsTotal }, (_, i) => ({
    gradeId: `g${i}`,
    subjectId: 's1',
    unitKeys: i < cellsWithUnit ? [`u${i}`] : [],
    assessmentIds: [],
    severity: null,
    lowestBandShare: null,
    classifications: 0,
    coverage: null,
    ladders: [],
    lowestBand: null,
  }));
  return {
    ladders: [],
    matrix: { grades: [], subjects: [], cells },
    bySubject: [],
    unclassified: { units: 0, classifications: 0 },
    totals: {
      classifications: 0,
      expectedClassifications: null,
      unitsWithMeasuredCut: null,
      units: 0,
    },
  } as ProcessResultsRollup;
}

function coverage(complete: number, expected: number): ProcessCoverageResponse {
  return {
    processId: 'p1',
    scopeDefined: true,
    scopeDerived: false,
    totals: { expected, missing: expected - complete, scheduled: 0, partial: 0, complete },
    cells: [],
    unexpectedCells: [],
  } as ProcessCoverageResponse;
}

describe('coverageSummaryOf — D4: el denominador viaja con la síntesis', () => {
  it('con alcance docente no entrega denominador', () => {
    // El de /coverage es el del colegio entero: contra un numerador ya recortado
    // daría siempre un cociente bajo el piso y el profesor no vería el titular.
    expect(coverageSummaryOf(rollup(2, 4), coverage(2, 4), false)).toBeNull();
  });

  it('con alcance de la org y cobertura declarada usa sus totales', () => {
    expect(coverageSummaryOf(rollup(2, 4), coverage(3, 8), true)).toEqual({
      loadedCells: 3,
      expectedCells: 8,
    });
  });

  it('sin alcance declarado cuenta las celdas que ya tienen unidad', () => {
    expect(coverageSummaryOf(rollup(2, 5), null, true)).toEqual({
      loadedCells: 2,
      expectedCells: 5,
    });
  });
});
