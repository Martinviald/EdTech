import {
  aggregateSample,
  classifyTypicalZone,
  percentileOf,
  percentileRank,
  sampleDeltaPp,
  sumBandCounts,
  weightedAverage,
  type SampleSourceRow,
} from './benchmark-sample';

const DIA_BANDS = (i: number, ii: number, iii: number) => [
  { bandKey: 'dia_nivel_1', label: 'Nivel I', order: 1, count: i },
  { bandKey: 'dia_nivel_2', label: 'Nivel II', order: 2, count: ii },
  { bandKey: 'dia_nivel_3', label: 'Nivel III', order: 3, count: iii },
];

function row(overrides: Partial<SampleSourceRow> = {}): SampleSourceRow {
  return {
    studentCount: 10,
    avgAchievement: 60,
    bandCounts: DIA_BANDS(2, 5, 3),
    perSkill: [],
    ...overrides,
  };
}

describe('weightedAverage', () => {
  it('pondera por peso e ignora nulos y pesos no positivos', () => {
    expect(
      weightedAverage([
        { value: 80, weight: 1 },
        { value: 60, weight: 3 },
        { value: null, weight: 5 },
        { value: 10, weight: 0 },
      ]),
    ).toBe(65);
  });

  it('devuelve null sin datos válidos', () => {
    expect(weightedAverage([])).toBeNull();
    expect(weightedAverage([{ value: null, weight: 3 }])).toBeNull();
  });
});

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
      row({ studentCount: 85, avgAchievement: 71.53, bandCounts: DIA_BANDS(10, 35, 40) }),
      row({ studentCount: 18, avgAchievement: 73.7, bandCounts: DIA_BANDS(0, 9, 9) }),
    ]);
    expect(sample.schoolCount).toBe(2);
    expect(sample.studentCount).toBe(103);
    expect(sample.avgAchievement).toBe(71.91);
    expect(sample.p25).toBeCloseTo(72.07, 1);
    expect(sample.median).toBeCloseTo(72.62, 1);
    expect(sample.p75).toBeCloseTo(73.16, 1);
    expect(sample.bandCounts).toEqual(DIA_BANDS(10, 44, 49));
  });

  it('ignora colegios sin % en promedio y percentiles pero suma sus alumnos', () => {
    const sample = aggregateSample([row({ avgAchievement: null, studentCount: 5 }), row()]);
    expect(sample.studentCount).toBe(15);
    expect(sample.avgAchievement).toBe(60);
    expect(sample.p25).toBe(60);
  });

  it('agrega habilidades por nodo con percentiles entre colegios', () => {
    const sample = aggregateSample([
      row({ perSkill: [{ nodeId: 'n1', nodeName: 'Inferir', achievement: 50, studentCount: 10 }] }),
      row({ perSkill: [{ nodeId: 'n1', nodeName: 'Inferir', achievement: 70, studentCount: 30 }] }),
      row({
        perSkill: [{ nodeId: 'n2', nodeName: 'Localizar', achievement: null, studentCount: 4 }],
      }),
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
