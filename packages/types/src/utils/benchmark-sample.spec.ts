import {
  aggregateItemSample,
  aggregateSample,
  classifyTypicalZone,
  percentileOf,
  percentileRank,
  sampleDeltaPp,
  sampleSizeLabel,
  sumBandCounts,
  type SampleSourceRow,
} from './benchmark-sample';

const DIA_BANDS = (i: number, ii: number, iii: number) => [
  { bandKey: 'dia_nivel_1', label: 'Nivel I', order: 1, count: i },
  { bandKey: 'dia_nivel_2', label: 'Nivel II', order: 2, count: ii },
  { bandKey: 'dia_nivel_3', label: 'Nivel III', order: 3, count: iii },
];

const POINTS_PER_STUDENT = 30;

/** Colegio con `studentCount` alumnos que rindieron todo y sacaron `pct` en promedio. */
function school(
  studentCount: number,
  pct: number | null,
): Pick<SampleSourceRow, 'studentCount' | 'scoreSum' | 'maxSum' | 'avgAchievement'> {
  const maxSum = pct === null ? 0 : studentCount * POINTS_PER_STUDENT;
  return {
    studentCount,
    scoreSum: pct === null ? 0 : (maxSum * pct) / 100,
    maxSum,
    avgAchievement: pct,
  };
}

function row(overrides: Partial<SampleSourceRow> = {}): SampleSourceRow {
  return {
    ...school(10, 60),
    bandCounts: DIA_BANDS(2, 5, 3),
    perSkill: [],
    ...overrides,
  };
}

function skill(nodeId: string, nodeName: string, studentCount: number, pct: number | null) {
  const maxSum = pct === null ? 0 : studentCount * 4;
  return {
    nodeId,
    nodeName,
    achievement: pct,
    studentCount,
    scoreSum: pct === null ? 0 : (maxSum * pct) / 100,
    maxSum,
  };
}

describe('percentileOf / percentileRank', () => {
  it('interpola linealmente', () => {
    expect(percentileOf([10, 20, 30, 40, 50], 25)).toBe(20);
    expect(percentileOf([71.53, 73.7], 25)).toBeCloseTo(72.07, 1);
    expect(percentileOf([42], 10)).toBe(42);
    expect(percentileOf([], 50)).toBeNull();
  });

  it('rango percentil con la mitad de los empates', () => {
    expect(percentileRank([40, 70, 70, 80], 70)).toBe(50);
    expect(percentileRank([], 70)).toBeNull();
    expect(percentileRank([1, 2], null)).toBeNull();
  });
});

describe('classifyTypicalZone', () => {
  it('ubica el valor frente a [p25, p75]', () => {
    expect(classifyTypicalZone(50, 55, 65)).toBe('below');
    expect(classifyTypicalZone(55, 55, 65)).toBe('within');
    expect(classifyTypicalZone(66, 55, 65)).toBe('above');
    expect(classifyTypicalZone(null, 55, 65)).toBeNull();
    expect(classifyTypicalZone(60, null, 65)).toBeNull();
  });
});

describe('sampleDeltaPp', () => {
  it('resta en pp y propaga nulos', () => {
    expect(sampleDeltaPp(62, 58.25)).toBe(3.75);
    expect(sampleDeltaPp(null, 58)).toBeNull();
  });
});

describe('sampleSizeLabel', () => {
  it('pluraliza colegios y alumnos', () => {
    expect(sampleSizeLabel({ schoolCount: 2, studentCount: 103 })).toBe('2 colegios · 103 alumnos');
    expect(sampleSizeLabel({ schoolCount: 1, studentCount: 1 })).toBe('1 colegio · 1 alumno');
  });
});

describe('sumBandCounts', () => {
  it('suma por clave de banda y ordena por order', () => {
    const summed = sumBandCounts([DIA_BANDS(0, 9, 9), [...DIA_BANDS(1, 2, 3)].reverse(), null]);
    expect(summed).toEqual(DIA_BANDS(1, 11, 12));
  });

  it('no muta las listas de entrada', () => {
    const input = DIA_BANDS(1, 1, 1);
    sumBandCounts([input, input]);
    expect(input[0]!.count).toBe(1);
  });
});

describe('aggregateSample', () => {
  it('reproduce Lectura 6° Intermedio 2026 con los dos colegios reales', () => {
    const sample = aggregateSample([
      row({ ...school(85, 71.53), bandCounts: DIA_BANDS(10, 35, 40) }),
      row({ ...school(18, 73.7), bandCounts: DIA_BANDS(0, 9, 9) }),
    ]);
    // Con todos los alumnos sobre el mismo máximo, Σ puntaje ÷ Σ máximo coincide con el
    // promedio ponderado por alumnos: (85·71,53 + 18·73,7) / 103 = 71,91.
    expect(sample.schoolCount).toBe(2);
    expect(sample.studentCount).toBe(103);
    expect(sample.avgAchievement).toBe(71.91);
    expect(sample.p25).toBeCloseTo(72.07, 1);
    expect(sample.median).toBeCloseTo(72.62, 1);
    expect(sample.p75).toBeCloseTo(73.16, 1);
    expect(sample.bandCounts).toEqual(DIA_BANDS(10, 44, 49));
  });

  it('ignora colegios sin puntaje corregido en el % y los percentiles, pero suma sus alumnos', () => {
    const sample = aggregateSample([row(school(5, null)), row()]);
    expect(sample.studentCount).toBe(15);
    expect(sample.avgAchievement).toBe(60);
    expect(sample.p25).toBe(60);
  });

  it('agrega habilidades por nodo sumando tallies, con percentiles entre colegios', () => {
    const sample = aggregateSample([
      row({ perSkill: [skill('n1', 'Inferir', 10, 50)] }),
      row({ perSkill: [skill('n1', 'Inferir', 30, 70)] }),
      row({ perSkill: [skill('n2', 'Localizar', 4, null)] }),
    ]);
    const inferir = sample.perSkill.find((s) => s.nodeId === 'n1')!;
    expect(inferir).toMatchObject({
      achievement: 65,
      studentCount: 40,
      schoolCount: 2,
      p10: 52,
      p25: 55,
    });
    const localizar = sample.perSkill.find((s) => s.nodeId === 'n2')!;
    expect(localizar.studentCount).toBe(4);
    expect(localizar).toMatchObject({ achievement: null, p10: null, schoolCount: 1 });
  });

  it('muestra vacía', () => {
    expect(aggregateSample([])).toMatchObject({
      schoolCount: 0,
      studentCount: 0,
      avgAchievement: null,
      p25: null,
      bandCounts: [],
      perSkill: [],
    });
  });
});

describe('aggregateItemSample', () => {
  it('suma los tallies de todos los colegios por ítem', () => {
    const sample = aggregateItemSample([
      { orgId: 'a', itemId: 'i1', correctCount: 30, responseCount: 80, scoreSum: 30, maxSum: 80 },
      { orgId: 'a', itemId: 'i2', correctCount: 70, responseCount: 85, scoreSum: 70, maxSum: 85 },
      { orgId: 'b', itemId: 'i1', correctCount: 6, responseCount: 18, scoreSum: 6, maxSum: 18 },
    ]);

    expect(sample.schoolCount).toBe(2);
    expect(sample.studentCount).toBe(103);
    const byItem = new Map(sample.items.map((i) => [i.itemId, i]));
    expect(byItem.get('i1')).toEqual({
      itemId: 'i1',
      correctRate: 36.73,
      responseCount: 98,
      schoolCount: 2,
    });
    expect(byItem.get('i2')).toMatchObject({ correctRate: 82.35, schoolCount: 1 });
  });

  it('cuenta el crédito parcial y las preguntas de 2 puntos, que los aciertos ignoran', () => {
    const sample = aggregateItemSample([
      { orgId: 'a', itemId: 'dev', correctCount: 10, responseCount: 40, scoreSum: 50, maxSum: 80 },
      { orgId: 'b', itemId: 'dev', correctCount: 2, responseCount: 10, scoreSum: 12, maxSum: 20 },
    ]);
    expect(sample.items[0]!.correctRate).toBe(62);
  });

  it('un ítem sin puntaje corregido queda sin tasa', () => {
    const sample = aggregateItemSample([
      { orgId: 'a', itemId: 'i1', correctCount: 0, responseCount: 12, scoreSum: 0, maxSum: 0 },
    ]);
    expect(sample.items[0]!.correctRate).toBeNull();
  });
});
