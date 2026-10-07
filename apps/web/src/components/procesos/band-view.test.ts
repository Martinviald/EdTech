import type { ProcessCoverageResponse } from '@soe/types';
import { coverageSummaryOf, processCoverageApplies } from './band-view';

function coverage(complete: number, expected: number): ProcessCoverageResponse {
  return {
    processId: 'p1',
    scopeDefined: expected > 0,
    scopeDerived: false,
    totals: {
      expected,
      missing: Math.max(expected - complete, 0),
      scheduled: 0,
      partial: 0,
      complete,
    },
    cells: [],
    unexpectedCells: [],
  } as ProcessCoverageResponse;
}

describe('coverageSummaryOf — D4: el denominador viaja con la síntesis', () => {
  it('con alcance docente no entrega denominador', () => {
    // El de /coverage es el del colegio entero: contra un numerador ya recortado
    // daría siempre un cociente bajo el piso y el profesor no vería el titular.
    expect(coverageSummaryOf(coverage(2, 4), false)).toBeNull();
  });

  it('con alcance de la org y cobertura declarada usa sus totales', () => {
    expect(coverageSummaryOf(coverage(3, 8), true)).toEqual({
      loadedCells: 3,
      expectedCells: 8,
    });
  });

  it('sin cobertura no inventa un denominador', () => {
    // Antes caía a contar las celdas del rollup, y como sin cobertura todas nacen
    // de unidades, daba loaded === expected: un proceso al 34 % se leía completo.
    expect(coverageSummaryOf(null, true)).toBeNull();
  });

  it('sin alcance declarado tampoco: expected es 0 y "12 de 0" no es un denominador', () => {
    expect(coverageSummaryOf(coverage(12, 0), true)).toBeNull();
  });
});

describe('processCoverageApplies — A1: el denominador del profesor no es el del colegio', () => {
  it('con alcance docente no se pide la cobertura', () => {
    expect(processCoverageApplies({ orgScoped: false, narrowedByFilters: false })).toBe(false);
  });

  it('con un filtro que recorta el proceso tampoco', () => {
    // El numerador queda recortado y el denominador de /coverage no: el cociente
    // caería bajo el piso y las celdas filtradas dirían "sin niveles".
    expect(processCoverageApplies({ orgScoped: true, narrowedByFilters: true })).toBe(false);
  });

  it('con alcance de la org y sin filtros, sí', () => {
    expect(processCoverageApplies({ orgScoped: true, narrowedByFilters: false })).toBe(true);
  });
});
