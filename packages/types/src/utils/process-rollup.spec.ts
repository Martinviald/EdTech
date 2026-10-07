import {
  deriveProcessRollup,
  isHeadlineTrustworthy,
  PROCESS_HEADLINE_COVERAGE_FLOOR,
} from './process-rollup';
import type { ComparableUnitSummary } from '../schemas/comparable-overview.schema';
import type {
  ProcessCoverageCell,
  ProcessCoverageResponse,
} from '../schemas/measurement-process.schema';
import type { PerformanceBandView } from '../schemas/performance-band.schema';

const DIA_LADDER: PerformanceBandView[] = [
  { key: 'n1', label: 'Nivel 1', order: 0, color: '#a00' },
  { key: 'n2', label: 'Nivel 2', order: 1, color: '#aa0' },
  { key: 'n3', label: 'Nivel 3', order: 2, color: '#0a0' },
];

const CEFR_LADDER: PerformanceBandView[] = [
  { key: 'a1', label: 'A1', order: 0, color: null },
  { key: 'a2', label: 'A2', order: 1, color: null },
  { key: 'b1', label: 'B1', order: 2, color: null },
  { key: 'b2', label: 'B2', order: 3, color: null },
];

function unit(over: Partial<ComparableUnitSummary> & { key: string }): ComparableUnitSummary {
  return {
    instrumentId: over.key,
    instrumentName: over.key,
    instrumentType: 'dia',
    subjectId: null,
    subjectName: null,
    gradeId: null,
    gradeName: null,
    applicationPeriod: null,
    year: null,
    assessmentIds: [],
    lastAdministeredAt: null,
    studentsAssessed: 0,
    averageAchievement: null,
    bands: null,
    bandDistribution: null,
    levelDistribution: null,
    lowestBandShare: null,
    byClassGroup: [],
    baseline: null,
    severity: null,
    ...over,
  } as ComparableUnitSummary;
}

function diaUnit(
  key: string,
  counts: [number, number, number],
  over: Partial<ComparableUnitSummary> = {},
): ComparableUnitSummary {
  const total = counts[0] + counts[1] + counts[2];
  return unit({
    key,
    studentsAssessed: total,
    bands: DIA_LADDER,
    bandDistribution: DIA_LADDER.map((b, i) => ({
      key: b.key,
      label: b.label,
      order: b.order,
      color: b.color ?? null,
      count: counts[i] as number,
      percentage: total > 0 ? ((counts[i] as number) / total) * 100 : 0,
    })),
    lowestBandShare: total > 0 ? (counts[0] / total) * 100 : null,
    ...over,
  });
}

function coverageCell(over: Partial<ProcessCoverageCell>): ProcessCoverageCell {
  return {
    classGroupId: 'cg',
    classGroupName: 'A',
    gradeId: 'g1',
    gradeShortName: '1B',
    gradeOrder: 1,
    subjectId: 's1',
    subjectName: 'Lenguaje',
    subjectShortName: 'LANG',
    status: 'complete',
    assessmentId: 'a1',
    assessmentName: null,
    studentsExpected: 26,
    studentsWithResults: 26,
    ...over,
  };
}

function coverage(cells: ProcessCoverageCell[]): ProcessCoverageResponse {
  return {
    processId: 'p1',
    scopeDefined: true,
    scopeDerived: false,
    totals: {
      expected: cells.length,
      missing: 0,
      scheduled: 0,
      partial: 0,
      complete: cells.length,
    },
    cells,
    unexpectedCells: [],
  };
}

describe('deriveProcessRollup — la regla', () => {
  it('suma clasificaciones de instrumentos distintos en una sola barra', () => {
    const r = deriveProcessRollup([diaUnit('u1', [10, 20, 5]), diaUnit('u2', [4, 30, 1])], null);

    expect(r.ladders).toHaveLength(1);
    const [ladder] = r.ladders;
    expect(ladder!.units).toBe(2);
    expect(ladder!.classifications).toBe(70);
    expect(ladder!.buckets.map((b) => b.classifications)).toEqual([14, 50, 6]);
    expect(ladder!.lowestBandShare).toBeCloseTo((14 / 70) * 100);
  });

  it('nunca emite un porcentaje de logro del proceso', () => {
    const r = deriveProcessRollup([diaUnit('u1', [1, 1, 1], { averageAchievement: 61 })], null);
    expect(JSON.stringify(r)).not.toContain('averageAchievement');
  });
});

describe('L1 — misma escalera', () => {
  it('dos escaleras distintas producen dos barras, nunca una mezclada', () => {
    const cefr = unit({
      key: 'ing',
      studentsAssessed: 12,
      bands: CEFR_LADDER,
      bandDistribution: CEFR_LADDER.map((b, i) => ({
        key: b.key,
        label: b.label,
        order: b.order,
        color: null,
        count: 3,
        percentage: 25,
      })),
      lowestBandShare: 25,
    });
    const r = deriveProcessRollup([diaUnit('u1', [10, 20, 5]), cefr], null);

    expect(r.ladders).toHaveLength(2);
    expect(r.ladders.map((l) => l.units)).toEqual([1, 1]);
    const keys = r.ladders.map((l) => l.buckets.map((b) => b.key));
    expect(keys).toContainEqual(['n1', 'n2', 'n3']);
    expect(keys).toContainEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it('la clave de escalera ignora el orden en que vienen las bandas', () => {
    const revuelta = diaUnit('u2', [1, 1, 1]);
    revuelta.bands = [...DIA_LADDER].reverse();
    const r = deriveProcessRollup([diaUnit('u1', [1, 1, 1]), revuelta], null);
    expect(r.ladders).toHaveLength(1);
  });
});

describe('L2 — la unidad contada es la clasificación', () => {
  it('un alumno en cuatro asignaturas aporta cuatro clasificaciones', () => {
    const r = deriveProcessRollup(
      [
        diaUnit('lang', [0, 1, 0]),
        diaUnit('math', [1, 0, 0]),
        diaUnit('sci', [0, 1, 0]),
        diaUnit('hist', [0, 0, 1]),
      ],
      null,
    );
    expect(r.totals.classifications).toBe(4);
  });
});

describe('L4 — procedencia del corte', () => {
  it('sin ninguna procedencia declarada no afirma nada', () => {
    const r = deriveProcessRollup([diaUnit('u1', [1, 1, 1])], null);
    expect(r.totals.unitsWithMeasuredCut).toBeNull();
  });

  it('cuenta sólo las unidades con corte declarado medido', () => {
    const medido = diaUnit('medido', [1, 1, 1]);
    medido.bands = DIA_LADDER.map((b) => ({ ...b, source: 'measured' as const }));
    const generico = diaUnit('generico', [1, 1, 1]);
    generico.bands = DIA_LADDER.map((b) => ({ ...b, source: 'generic' as const }));

    const r = deriveProcessRollup([medido, generico], null);
    expect(r.totals.unitsWithMeasuredCut).toBe(1);
  });
});

describe('D10 — lo que no se puede clasificar se cuenta aparte', () => {
  it('una unidad sin bandas no entra en la barra y no desaparece', () => {
    const sinBandas = unit({ key: 'sin', studentsAssessed: 30 });
    const r = deriveProcessRollup([diaUnit('u1', [10, 20, 5]), sinBandas], null);

    expect(r.ladders[0]!.classifications).toBe(35);
    expect(r.unclassified).toEqual({ units: 1, classifications: 30 });
    expect(r.totals.classifications).toBe(65);
  });
});

describe('la matriz nivel × asignatura', () => {
  it('cruza unidades con celdas de cobertura por gradeId, no por nombre', () => {
    const u = diaUnit('u1', [5, 5, 0], { gradeId: 'g1', subjectId: 's1', assessmentIds: ['a1'] });
    const r = deriveProcessRollup(
      [u],
      coverage([
        coverageCell({}),
        coverageCell({
          classGroupId: 'cg2',
          subjectId: 's2',
          subjectName: 'Mate',
          status: 'missing',
        }),
      ]),
    );

    const conUnidad = r.matrix.cells.find((c) => c.subjectId === 's1');
    expect(conUnidad?.unitKeys).toEqual(['u1']);
    expect(conUnidad?.coverage).toBeNull();

    const sinUnidad = r.matrix.cells.find((c) => c.subjectId === 's2');
    expect(sinUnidad?.unitKeys).toEqual([]);
    expect(sinUnidad?.coverage).toBe('missing');
  });

  it('una celda sin unidad se queda con el peor estado de sus cursos', () => {
    const r = deriveProcessRollup(
      [],
      coverage([
        coverageCell({ classGroupId: 'cgA', status: 'complete' }),
        coverageCell({ classGroupId: 'cgB', status: 'missing' }),
        coverageCell({ classGroupId: 'cgC', status: 'partial' }),
      ]),
    );
    expect(r.matrix.cells).toHaveLength(1);
    expect(r.matrix.cells[0]!.coverage).toBe('missing');
  });

  it('con varias unidades en la celda toma la severidad peor y el share mayor por unidad', () => {
    const r = deriveProcessRollup(
      [
        diaUnit('a', [1, 9, 0], {
          gradeId: 'g1',
          subjectId: 's1',
          severity: 'low',
          lowestBandShare: 10,
        }),
        diaUnit('b', [6, 4, 0], {
          gradeId: 'g1',
          subjectId: 's1',
          severity: 'high',
          lowestBandShare: 60,
        }),
      ],
      null,
    );
    const cell = r.matrix.cells[0]!;
    expect(cell.severity).toBe('high');
    // `lowestBandShare` sigue siendo el máximo POR UNIDAD: es lo que ordena y
    // alerta desde antes. Lo que no se puede es mostrarlo junto a
    // `classifications`, que es la suma de las dos unidades.
    expect(cell.lowestBandShare).toBe(60);
    expect(cell.classifications).toBe(20);
    expect(cell.unitKeys).toEqual(['a', 'b']);
  });

  it('suma los conteos por banda de la celda y da el share con su propio denominador', () => {
    const r = deriveProcessRollup(
      [
        diaUnit('a', [1, 9, 0], { gradeId: 'g1', subjectId: 's1', lowestBandShare: 10 }),
        diaUnit('b', [6, 4, 0], { gradeId: 'g1', subjectId: 's1', lowestBandShare: 60 }),
      ],
      null,
    );
    const cell = r.matrix.cells[0]!;
    expect(cell.ladders).toHaveLength(1);
    expect(cell.ladders[0]!.buckets.map((b) => b.classifications)).toEqual([7, 13, 0]);
    // Ni 60 (el máximo de una unidad) ni 20 como denominador de ese 60: 7 de 20.
    expect(cell.lowestBand).toEqual({ classifications: 7, of: 20, share: 35 });
  });

  it('con dos escaleras distintas en la celda no emite ningún share', () => {
    const cefr = unit({
      key: 'ingles',
      gradeId: 'g1',
      subjectId: 's1',
      studentsAssessed: 10,
      bands: CEFR_LADDER,
      bandDistribution: CEFR_LADDER.map((b, i) => ({
        key: b.key,
        label: b.label,
        order: b.order,
        color: null,
        count: i === 0 ? 10 : 0,
        percentage: i === 0 ? 100 : 0,
      })),
      lowestBandShare: 100,
    });
    const r = deriveProcessRollup(
      [diaUnit('dia', [1, 9, 0], { gradeId: 'g1', subjectId: 's1' }), cefr],
      null,
    );
    const cell = r.matrix.cells[0]!;
    expect(cell.ladders).toHaveLength(2);
    expect(cell.lowestBand).toBeNull();
  });

  it('con una sola unidad el share de la celda es el de la unidad', () => {
    const r = deriveProcessRollup(
      [diaUnit('u1', [5, 10, 5], { gradeId: 'g1', subjectId: 's1' })],
      null,
    );
    const cell = r.matrix.cells[0]!;
    expect(cell.lowestBand).toEqual({ classifications: 5, of: 20, share: 25 });
    expect(cell.lowestBand!.share).toBeCloseTo(cell.lowestBandShare as number, 10);
  });

  it('ordena las filas por grado y no por el orden en que vienen las unidades', () => {
    // Las unidades llegan ordenadas por severidad, así que sin orden explícito
    // 8° aparecería antes que 1°.
    const r = deriveProcessRollup(
      [
        diaUnit('u8', [9, 1, 0], { gradeId: 'g8', gradeName: '8B', subjectId: 's1' }),
        diaUnit('u1', [1, 9, 0], { gradeId: 'g1', gradeName: '1B', subjectId: 's1' }),
      ],
      null,
      new Map([
        ['g1', 0],
        ['g8', 7],
      ]),
    );
    expect(r.matrix.grades.map((g) => g.name)).toEqual(['1B', '8B']);
  });

  it('un grado ausente del catálogo va al final, no al orden de la BD', () => {
    // El catálogo de /dashboards/filters está acotado a un año y al alcance del
    // usuario: un grado del proceso puede no estar. Con el mapa presente manda el
    // mapa, y el ausente va último — mezclar índice con grades.order los empata.
    const r = deriveProcessRollup(
      [
        diaUnit('u8', [9, 1, 0], { gradeId: 'g8', gradeName: '8B', subjectId: 's1' }),
        diaUnit('u1', [1, 9, 0], { gradeId: 'g1', gradeName: '1B', subjectId: 's1' }),
      ],
      coverage([
        coverageCell({ gradeId: 'gx', gradeShortName: 'PK', gradeOrder: -1, assessmentId: null }),
      ]),
      new Map([
        ['g1', 0],
        ['g8', 7],
      ]),
    );
    expect(r.matrix.grades.map((g) => g.name)).toEqual(['1B', '8B', 'PK']);
  });

  it('sin orden de grados conserva el comportamiento previo', () => {
    const r = deriveProcessRollup(
      [
        diaUnit('u8', [9, 1, 0], { gradeId: 'g8', gradeName: '8B', subjectId: 's1' }),
        diaUnit('u1', [1, 9, 0], { gradeId: 'g1', gradeName: '1B', subjectId: 's1' }),
      ],
      null,
    );
    expect(r.matrix.grades.map((g) => g.name)).toEqual(['8B', '1B']);
  });

  it('un alumno sin banda no entra en el denominador de la celda', () => {
    // El alumno con TODAS sus preguntas pendientes queda sin banda: aporta a
    // `studentsAssessed` de la unidad pero no a su `bandDistribution`. El
    // denominador de la celda es el de las clasificaciones, no el de los
    // alumnos. Ver §10 del plan.
    const conPendiente = diaUnit('u1', [3, 7, 0], { gradeId: 'g1', subjectId: 's1' });
    const r = deriveProcessRollup(
      [{ ...conPendiente, studentsAssessed: 12 } as ComparableUnitSummary],
      null,
    );
    const cell = r.matrix.cells[0]!;
    expect(cell.classifications).toBe(12);
    expect(cell.lowestBand).toEqual({ classifications: 3, of: 10, share: 30 });
  });
});

describe('regresiones que encontró la auditoría', () => {
  it('una celda sin unidad conserva el enlace a su evaluación', () => {
    const r = deriveProcessRollup(
      [],
      coverage([coverageCell({ status: 'scheduled', assessmentId: 'a-sin-resultados' })]),
    );
    expect(r.matrix.cells[0]!.assessmentIds).toEqual(['a-sin-resultados']);
    expect(r.matrix.cells[0]!.coverage).toBe('scheduled');
  });

  it('no duplica el id cuando la unidad trae la misma evaluación que la cobertura', () => {
    const r = deriveProcessRollup(
      [diaUnit('u1', [1, 1, 0], { gradeId: 'g1', subjectId: 's1', assessmentIds: ['a1'] })],
      coverage([coverageCell({ assessmentId: 'a1' })]),
    );
    expect(r.matrix.cells[0]!.assessmentIds).toEqual(['a1']);
  });

  it('`unknown` no cuenta como corte declarado', () => {
    const u = diaUnit('u1', [1, 1, 1]);
    u.bands = DIA_LADDER.map((b) => ({ ...b, source: 'unknown' as const }));
    expect(deriveProcessRollup([u], null).totals.unitsWithMeasuredCut).toBeNull();
  });

  it('con `unknown` y `measured` mezclados cuenta sólo el declarado', () => {
    const medido = diaUnit('m', [1, 1, 1]);
    medido.bands = DIA_LADDER.map((b) => ({ ...b, source: 'measured' as const }));
    const desconocido = diaUnit('d', [1, 1, 1]);
    desconocido.bands = DIA_LADDER.map((b) => ({ ...b, source: 'unknown' as const }));
    expect(deriveProcessRollup([medido, desconocido], null).totals.unitsWithMeasuredCut).toBe(1);
  });
});

describe('por asignatura — navegación, no medición', () => {
  it('reporta severidades y la peor celda, sin promediar logro', () => {
    const r = deriveProcessRollup(
      [
        diaUnit('m1', [6, 4, 0], {
          subjectId: 's1',
          subjectName: 'Mate',
          severity: 'high',
          lowestBandShare: 60,
        }),
        diaUnit('m2', [1, 9, 0], {
          subjectId: 's1',
          subjectName: 'Mate',
          severity: 'low',
          lowestBandShare: 10,
        }),
      ],
      null,
    );
    const mate = r.bySubject[0]!;
    expect(mate.units).toBe(2);
    expect(mate.bySeverity).toEqual({ high: 1, medium: 0, low: 1 });
    expect(mate.worstUnitKey).toBe('m1');
    expect(mate.worstLowestBandShare).toBe(60);
    expect(mate).not.toHaveProperty('averageAchievement');
  });
});

describe('el piso de cobertura', () => {
  it('bajo el piso el titular no es confiable', () => {
    expect(
      isHeadlineTrustworthy({
        classifications: 850,
        expectedClassifications: 2496,
        unitsWithMeasuredCut: null,
        units: 24,
      }),
    ).toBe(false);
  });

  it('sobre el piso sí lo es', () => {
    expect(
      isHeadlineTrustworthy({
        classifications: 2253,
        expectedClassifications: 2496,
        unitsWithMeasuredCut: null,
        units: 32,
      }),
    ).toBe(true);
  });

  it('justo en el piso cuenta como confiable', () => {
    expect(
      isHeadlineTrustworthy({
        classifications: PROCESS_HEADLINE_COVERAGE_FLOOR * 100,
        expectedClassifications: 100,
        unitsWithMeasuredCut: null,
        units: 1,
      }),
    ).toBe(true);
  });

  it('sin denominador no se gatea: callar por no saber sería peor', () => {
    expect(
      isHeadlineTrustworthy({
        classifications: 10,
        expectedClassifications: null,
        unitsWithMeasuredCut: null,
        units: 1,
      }),
    ).toBe(true);
  });
});

describe('casos borde', () => {
  it('sin unidades ni cobertura devuelve una estructura vacía utilizable', () => {
    const r = deriveProcessRollup([], null);
    expect(r.ladders).toEqual([]);
    expect(r.matrix.cells).toEqual([]);
    expect(r.totals).toEqual({
      classifications: 0,
      expectedClassifications: null,
      unitsWithMeasuredCut: null,
      units: 0,
    });
  });

  it('una unidad con cero clasificaciones no divide por cero', () => {
    const r = deriveProcessRollup([diaUnit('vacia', [0, 0, 0])], null);
    expect(r.ladders[0]!.lowestBandShare).toBeNull();
    expect(r.ladders[0]!.buckets.every((b) => b.percentage === 0)).toBe(true);
  });

  it('las clasificaciones esperadas salen de las celdas de cobertura', () => {
    const r = deriveProcessRollup(
      [],
      coverage([
        coverageCell({ studentsExpected: 26 }),
        coverageCell({ classGroupId: 'cg2', studentsExpected: 30 }),
      ]),
    );
    expect(r.totals.expectedClassifications).toBe(56);
  });
});
