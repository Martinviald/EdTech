import type { ComparableUnitSummary } from '../schemas/comparable-overview.schema';
import { deriveGenerationalHighlights } from './generational-highlights';

function makeUnit(overrides: Partial<ComparableUnitSummary> = {}): ComparableUnitSummary {
  return {
    key: 'i1',
    instrumentId: 'i1',
    instrumentName: 'DIA Lectura 3°',
    instrumentType: 'dia',
    subjectId: 's-leng',
    subjectName: 'Lenguaje',
    gradeId: 'g3',
    gradeName: '3° Básico',
    applicationPeriod: 'diagnostico',
    year: 2026,
    assessmentIds: ['a1'],
    lastAdministeredAt: null,
    studentsAssessed: 100,
    averageAchievement: 60,
    bands: null,
    bandDistribution: null,
    levelDistribution: null,
    lowestBandShare: null,
    byClassGroup: [],
    baseline: {
      kind: 'previous_year',
      label: 'DIA Lectura 3° 2025',
      instrumentId: 'i0',
      assessmentIds: ['a0'],
      achievement: 70,
      deltaPp: -10,
    },
    severity: null,
    ...overrides,
  };
}

describe('deriveGenerationalHighlights', () => {
  it('arma una celda por asignatura × nivel con su delta contra el año anterior', () => {
    const [cell] = deriveGenerationalHighlights([makeUnit()]);

    expect(cell!.gradeName).toBe('3° Básico');
    expect(cell!.subjectName).toBe('Lenguaje');
    expect(cell!.achievement).toBe(60);
    expect(cell!.baselineAchievement).toBe(70);
    expect(cell!.deltaPp).toBe(-10);
    expect(cell!.year).toBe(2026);
    expect(cell!.baselineYear).toBe(2025);
  });

  it('ignora el baseline de momento anterior: eso es progresión del mismo grupo, no generación', () => {
    const unit = makeUnit({
      baseline: {
        kind: 'previous_period',
        label: 'Monitoreo 2026',
        instrumentId: 'i0',
        assessmentIds: ['a0'],
        achievement: 70,
        deltaPp: -10,
      },
    });

    expect(deriveGenerationalHighlights([unit])).toEqual([]);
  });

  it('agrega varias unidades de la misma celda ponderando por alumnos', () => {
    const units = [
      makeUnit({
        instrumentId: 'i1',
        studentsAssessed: 10,
        averageAchievement: 90,
        baseline: {
          kind: 'previous_year',
          label: '2025',
          instrumentId: 'i0',
          assessmentIds: ['a0'],
          achievement: 90,
          deltaPp: 0,
        },
      }),
      makeUnit({
        instrumentId: 'i2',
        studentsAssessed: 30,
        averageAchievement: 50,
        baseline: {
          kind: 'previous_year',
          label: '2025',
          instrumentId: 'i0b',
          assessmentIds: ['a0b'],
          achievement: 70,
          deltaPp: -20,
        },
      }),
    ];

    const [cell] = deriveGenerationalHighlights(units);

    // (90×10 + 50×30) / 40 = 60. Un promedio simple daría 70.
    expect(cell!.achievement).toBeCloseTo(60, 6);
    // (90×10 + 70×30) / 40 = 75.
    expect(cell!.baselineAchievement).toBeCloseTo(75, 6);
    expect(cell!.deltaPp).toBe(-15);
    expect(cell!.studentsAssessed).toBe(40);
    expect(cell!.instrumentIds).toEqual(['i1', 'i2']);
  });

  it('cuando la celda mezcla momentos no declara ninguno', () => {
    const units = [
      makeUnit({ instrumentId: 'i1', applicationPeriod: 'diagnostico' }),
      makeUnit({ instrumentId: 'i2', applicationPeriod: 'cierre' }),
    ];

    expect(deriveGenerationalHighlights(units)[0]!.applicationPeriod).toBeNull();
  });

  it('ordena por magnitud de la caída: lo que más retrocedió primero', () => {
    const units = [
      makeUnit({
        instrumentId: 'i1',
        gradeId: 'g3',
        subjectId: 's-leng',
        averageAchievement: 68,
        baseline: {
          kind: 'previous_year',
          label: '2025',
          instrumentId: 'i0',
          assessmentIds: ['a0'],
          achievement: 70,
          deltaPp: -2,
        },
      }),
      makeUnit({
        instrumentId: 'i2',
        gradeId: 'g8',
        gradeName: '8° Básico',
        subjectId: 's-mate',
        subjectName: 'Matemática',
        averageAchievement: 40,
        baseline: {
          kind: 'previous_year',
          label: '2025',
          instrumentId: 'i0b',
          assessmentIds: ['a0b'],
          achievement: 70,
          deltaPp: -30,
        },
      }),
    ];

    expect(deriveGenerationalHighlights(units).map((c) => c.gradeName)).toEqual([
      '8° Básico',
      '3° Básico',
    ]);
  });

  it('una unidad sin baseline resuelto no aporta celda', () => {
    expect(deriveGenerationalHighlights([makeUnit({ baseline: null })])).toEqual([]);
  });
});
