import {
  compareSeverity,
  severityFromAverageBand,
  bandForAchievement,
  type SeverityBand,
  buildComparabilityMeta,
  buildInstrumentFamilyKey,
  buildInstrumentHistoryKey,
  buildPeriodSeriesKey,
  deltaInPoints,
  isAggregatable,
  previousApplicationPeriod,
  resolveComparabilityKind,
  type ComparabilityInstrumentRef,
} from './comparability';

const MATE_8_CIERRE_2026: ComparabilityInstrumentRef = {
  instrumentId: 'i-1',
  type: 'dia',
  subjectId: 's-mate',
  gradeId: 'g-8',
  applicationPeriod: 'cierre',
  year: 2026,
  trackId: null,
};

const PAES_M1_E3: ComparabilityInstrumentRef = {
  instrumentId: 'i-m1-e3',
  type: 'paes',
  subjectId: 's-mate',
  gradeId: 'g-iv',
  applicationPeriod: null,
  year: 2026,
  trackId: 't-m1',
};
const PAES_M2_E3: ComparabilityInstrumentRef = {
  ...PAES_M1_E3,
  instrumentId: 'i-m2-e3',
  trackId: 't-m2',
};

function variant(
  base: ComparabilityInstrumentRef,
  patch: Partial<ComparabilityInstrumentRef>,
): ComparabilityInstrumentRef {
  return { ...base, ...patch };
}

describe('resolveComparabilityKind', () => {
  it('sin instrumentos es "empty", no "mixed"', () => {
    expect(resolveComparabilityKind([])).toBe('empty');
  });

  it('N0 — un instrumento con una sola aplicación es single_assessment', () => {
    expect(resolveComparabilityKind([MATE_8_CIERRE_2026], 1)).toBe('single_assessment');
  });

  it('N1 — un instrumento aplicado a varios cursos es single_instrument', () => {
    expect(resolveComparabilityKind([MATE_8_CIERRE_2026], 4)).toBe('single_instrument');
  });

  it('N2 — el mismo instrumento en años distintos es instrument_family', () => {
    const refs = [
      MATE_8_CIERRE_2026,
      variant(MATE_8_CIERRE_2026, { instrumentId: 'i-2', year: 2025 }),
    ];
    expect(resolveComparabilityKind(refs, 8)).toBe('instrument_family');
  });

  it('N3 — momentos distintos del mismo año es period_series', () => {
    const refs = [
      MATE_8_CIERRE_2026,
      variant(MATE_8_CIERRE_2026, { instrumentId: 'i-2', applicationPeriod: 'diagnostico' }),
    ];
    expect(resolveComparabilityKind(refs, 8)).toBe('period_series');
  });

  it('instrumentos de asignaturas distintas es mixed', () => {
    const refs = [
      MATE_8_CIERRE_2026,
      variant(MATE_8_CIERRE_2026, { instrumentId: 'i-2', subjectId: 's-leng' }),
    ];
    expect(resolveComparabilityKind(refs, 8)).toBe('mixed');
  });

  it('N4 — variar año Y momento sobre la misma medición es instrument_history', () => {
    const refs = [
      MATE_8_CIERRE_2026,
      variant(MATE_8_CIERRE_2026, {
        instrumentId: 'i-2',
        year: 2025,
        applicationPeriod: 'diagnostico',
      }),
    ];
    expect(resolveComparabilityKind(refs, 8)).toBe('instrument_history');
    expect(isAggregatable('instrument_history')).toBe(false);
  });

  it('mismo nivel y asignatura pero distinto tipo de instrumento es mixed', () => {
    const refs = [
      MATE_8_CIERRE_2026,
      variant(MATE_8_CIERRE_2026, { instrumentId: 'i-2', type: 'simce' }),
    ];
    expect(resolveComparabilityKind(refs, 8)).toBe('mixed');
  });
});

describe('isAggregatable', () => {
  it('sólo N0 y N1 se pueden promediar en un número', () => {
    expect(isAggregatable('single_assessment')).toBe(true);
    expect(isAggregatable('single_instrument')).toBe(true);
    expect(isAggregatable('instrument_family')).toBe(false);
    expect(isAggregatable('period_series')).toBe(false);
    expect(isAggregatable('instrument_history')).toBe(false);
    expect(isAggregatable('mixed')).toBe(false);
    expect(isAggregatable('empty')).toBe(false);
  });
});

describe('claves de comparabilidad', () => {
  it('la clave de familia ignora el año (es lo que varía dentro de una familia)', () => {
    const otroAnio = variant(MATE_8_CIERRE_2026, { year: 2025 });
    expect(buildInstrumentFamilyKey(otroAnio)).toBe(buildInstrumentFamilyKey(MATE_8_CIERRE_2026));
  });

  it('la clave de serie ignora el momento', () => {
    const otroMomento = variant(MATE_8_CIERRE_2026, { applicationPeriod: 'diagnostico' });
    expect(buildPeriodSeriesKey(otroMomento)).toBe(buildPeriodSeriesKey(MATE_8_CIERRE_2026));
  });

  it('un subjectId nulo no colisiona con otro instrumento de asignatura real', () => {
    const sinAsignatura = variant(MATE_8_CIERRE_2026, { subjectId: null });
    expect(buildInstrumentFamilyKey(sinAsignatura)).not.toBe(
      buildInstrumentFamilyKey(MATE_8_CIERRE_2026),
    );
  });
});

describe('claves de comparabilidad con línea de prueba', () => {
  it('sin línea, las tres claves son idénticas a las de siempre', () => {
    expect(buildInstrumentFamilyKey(MATE_8_CIERRE_2026)).toBe('dia|s-mate|g-8|cierre');
    expect(buildPeriodSeriesKey(MATE_8_CIERRE_2026)).toBe('dia|s-mate|g-8|2026');
    expect(buildInstrumentHistoryKey(MATE_8_CIERRE_2026)).toBe('dia|s-mate|g-8');
  });

  it('M1 y M2 del mismo grado y tanda no comparten ninguna clave', () => {
    expect(buildInstrumentFamilyKey(PAES_M1_E3)).not.toBe(buildInstrumentFamilyKey(PAES_M2_E3));
    expect(buildPeriodSeriesKey(PAES_M1_E3)).not.toBe(buildPeriodSeriesKey(PAES_M2_E3));
    expect(buildInstrumentHistoryKey(PAES_M1_E3)).not.toBe(buildInstrumentHistoryKey(PAES_M2_E3));
  });

  it('M1 de dos tandas distintas sigue siendo la misma familia', () => {
    const m1E4 = variant(PAES_M1_E3, { instrumentId: 'i-m1-e4' });
    expect(buildInstrumentFamilyKey(m1E4)).toBe(buildInstrumentFamilyKey(PAES_M1_E3));
  });

  it('una línea no colisiona con el mismo instrumento sin línea', () => {
    const sinLinea = variant(PAES_M1_E3, { trackId: null });
    expect(buildInstrumentFamilyKey(sinLinea)).not.toBe(buildInstrumentFamilyKey(PAES_M1_E3));
  });

  it('M1 y M2 juntos no son una familia: el alcance es mixto', () => {
    expect(resolveComparabilityKind([PAES_M1_E3, PAES_M2_E3], 2)).toBe('mixed');
    expect(
      resolveComparabilityKind([PAES_M1_E3, variant(PAES_M1_E3, { instrumentId: 'x' })], 2),
    ).toBe('instrument_family');
  });
});

describe('previousApplicationPeriod', () => {
  it('devuelve el momento anterior del ciclo', () => {
    expect(previousApplicationPeriod('cierre')).toBe('intermedio');
    expect(previousApplicationPeriod('intermedio')).toBe('diagnostico');
  });

  it('el primero del ciclo y el instrumento sin momento no tienen anterior', () => {
    expect(previousApplicationPeriod('diagnostico')).toBeNull();
    expect(previousApplicationPeriod(null)).toBeNull();
  });
});

describe('buildComparabilityMeta', () => {
  it('un alcance agregable no lleva motivo que explicar', () => {
    const meta = buildComparabilityMeta([MATE_8_CIERRE_2026], 1);
    expect(meta.aggregatable).toBe(true);
    expect(meta.reason).toBeNull();
    expect(meta.instrumentIds).toEqual(['i-1']);
    expect(meta.familyKey).toBe(buildInstrumentFamilyKey(MATE_8_CIERRE_2026));
  });

  it('un alcance mixto no es agregable y explica por qué, citando el número de instrumentos', () => {
    const refs = [
      MATE_8_CIERRE_2026,
      variant(MATE_8_CIERRE_2026, { instrumentId: 'i-2', subjectId: 's-leng' }),
    ];
    const meta = buildComparabilityMeta(refs, 8);
    expect(meta.aggregatable).toBe(false);
    expect(meta.reason).toContain('2 instrumentos');
    expect(meta.familyKey).toBeNull();
  });

  it('una familia conserva su familyKey aunque no sea agregable', () => {
    const refs = [
      MATE_8_CIERRE_2026,
      variant(MATE_8_CIERRE_2026, { instrumentId: 'i-2', year: 2025 }),
    ];
    const meta = buildComparabilityMeta(refs, 8);
    expect(meta.aggregatable).toBe(false);
    expect(meta.familyKey).toBe(buildInstrumentFamilyKey(MATE_8_CIERRE_2026));
  });
});

describe('deltaInPoints', () => {
  it('una caída es negativa y se redondea a un decimal', () => {
    expect(deltaInPoints(48, 60)).toBe(-12);
    expect(deltaInPoints(48.26, 40)).toBe(8.3);
  });

  it('sin alguno de los dos extremos no hay delta', () => {
    expect(deltaInPoints(null, 60)).toBeNull();
    expect(deltaInPoints(48, null)).toBeNull();
  });
});

describe('severidad de una unidad comparable', () => {
  const BINARIA: SeverityBand[] = [
    {
      key: 'apoyo',
      label: 'Requiere mayor apoyo',
      order: 0,
      minThreshold: 0,
      maxThreshold: 0.7884,
    },
    {
      key: 'logrado',
      label: 'No requiere mayor apoyo',
      order: 1,
      minThreshold: 0.7884,
      maxThreshold: 1,
    },
  ];
  const TRES_NIVELES: SeverityBand[] = [
    { key: 'n1', label: 'Nivel I', order: 0, minThreshold: 0, maxThreshold: 0.4 },
    { key: 'n2', label: 'Nivel II', order: 1, minThreshold: 0.4, maxThreshold: 0.76 },
    { key: 'n3', label: 'Nivel III', order: 2, minThreshold: 0.76, maxThreshold: 1 },
  ];

  it('la determina la banda del instrumento en la que cae el promedio', () => {
    expect(severityFromAverageBand(71.4, BINARIA)).toBe('high');
    expect(severityFromAverageBand(82.6, BINARIA)).toBe('low');
    expect(severityFromAverageBand(35, TRES_NIVELES)).toBe('high');
    expect(severityFromAverageBand(55, TRES_NIVELES)).toBe('medium');
    expect(severityFromAverageBand(90, TRES_NIVELES)).toBe('low');
  });

  it('el mismo promedio es grave o leve según el corte de su instrumento', () => {
    expect(severityFromAverageBand(71.4, BINARIA)).toBe('high');
    expect(severityFromAverageBand(71.4, TRES_NIVELES)).toBe('medium');
  });

  it('un instrumento binario nunca da atención', () => {
    for (const promedio of [0, 20, 50, 78.83, 78.84, 95, 100]) {
      expect(severityFromAverageBand(promedio, BINARIA)).not.toBe('medium');
    }
  });

  it('el corte exacto pertenece a la banda superior y el 100% a la última', () => {
    expect(severityFromAverageBand(78.84, BINARIA)).toBe('low');
    expect(severityFromAverageBand(100, BINARIA)).toBe('low');
    expect(bandForAchievement(78.84, BINARIA)?.key).toBe('logrado');
    expect(bandForAchievement(78.83, BINARIA)?.key).toBe('apoyo');
  });

  it('no depende del orden en que lleguen las bandas', () => {
    expect(severityFromAverageBand(55, [...TRES_NIVELES].reverse())).toBe('medium');
  });

  it('sin bandas, con una sola o sin promedio no se inventa una severidad', () => {
    expect(severityFromAverageBand(71.4, null)).toBeNull();
    expect(severityFromAverageBand(71.4, [])).toBeNull();
    expect(severityFromAverageBand(71.4, [BINARIA[0]!])).toBeNull();
    expect(severityFromAverageBand(null, BINARIA)).toBeNull();
  });

  it('ordena lo urgente primero y deja al final lo que no se puede evaluar', () => {
    const orden = ['low', 'high', null, 'medium'] as const;
    const ordenado = [...orden].sort(compareSeverity);
    expect(ordenado).toEqual(['high', 'medium', 'low', null]);
  });
});
