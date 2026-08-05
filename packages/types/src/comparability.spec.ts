import {
  buildComparabilityMeta,
  buildInstrumentFamilyKey,
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

  it('variar año Y momento a la vez rompe las dos claves: mixed', () => {
    const refs = [
      MATE_8_CIERRE_2026,
      variant(MATE_8_CIERRE_2026, {
        instrumentId: 'i-2',
        year: 2025,
        applicationPeriod: 'diagnostico',
      }),
    ];
    expect(resolveComparabilityKind(refs, 8)).toBe('mixed');
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
