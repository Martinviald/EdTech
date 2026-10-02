import { attachSeverity, sortAssessments, type AssessmentWithSeverity } from './assessment-severity';
import type { AssessmentOption } from '../schemas/item-analysis.schema';
import type { ComparableUnitSummary } from '../schemas/comparable-overview.schema';

function assessment(overrides: Partial<AssessmentOption> & { assessmentId: string }): AssessmentOption {
  return {
    name: null,
    instrumentName: 'Instrumento',
    instrumentType: 'dia',
    subjectName: null,
    gradeName: null,
    administeredAt: null,
    studentsCount: 0,
    ...overrides,
  };
}

function unit(overrides: Partial<ComparableUnitSummary> & { key: string }): ComparableUnitSummary {
  return {
    instrumentId: overrides.key,
    instrumentName: 'Instrumento',
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
    ...overrides,
  } as ComparableUnitSummary;
}

describe('attachSeverity', () => {
  it('cuelga la severidad de la unidad que contiene la evaluación', () => {
    const rows = attachSeverity(
      [assessment({ assessmentId: 'a1' }), assessment({ assessmentId: 'a2' })],
      [unit({ key: 'u1', assessmentIds: ['a1'], severity: 'high', lowestBandShare: 52 })],
    );

    expect(rows[0]).toMatchObject({ severity: 'high', lowestBandShare: 52, unitKey: 'u1' });
    expect(rows[1]).toMatchObject({ severity: null, lowestBandShare: null, unitKey: null });
  });

  it('una unidad con varias aplicaciones las marca a todas', () => {
    const rows = attachSeverity(
      [assessment({ assessmentId: 'a1' }), assessment({ assessmentId: 'a2' })],
      [unit({ key: 'u1', assessmentIds: ['a1', 'a2'], severity: 'medium' })],
    );

    expect(rows.every((r) => r.severity === 'medium')).toBe(true);
  });

  it('sin unidades, todo queda no clasificable en vez de romper', () => {
    const rows = attachSeverity([assessment({ assessmentId: 'a1' })], []);
    expect(rows[0]!.severity).toBeNull();
  });
});

describe('sortAssessments', () => {
  const base: AssessmentWithSeverity[] = [
    {
      ...assessment({ assessmentId: 'sin', studentsCount: 99 }),
      severity: null,
      lowestBandShare: null,
      unitKey: null,
    },
    {
      ...assessment({ assessmentId: 'media', studentsCount: 10 }),
      severity: 'medium',
      lowestBandShare: 30,
      unitKey: 'u2',
    },
    {
      ...assessment({ assessmentId: 'grave-pocos', studentsCount: 5 }),
      severity: 'high',
      lowestBandShare: 45,
      unitKey: 'u3',
    },
    {
      ...assessment({ assessmentId: 'grave-muchos', studentsCount: 40 }),
      severity: 'high',
      lowestBandShare: 41,
      unitKey: 'u4',
    },
  ];

  it('las graves primero, y entre ellas la que afecta a más alumnos', () => {
    const orden = sortAssessments(base, 'severity').map((r) => r.assessmentId);
    expect(orden).toEqual(['grave-muchos', 'grave-pocos', 'media', 'sin']);
  });

  it('las no clasificables van al final, nunca arriba por tener más alumnos', () => {
    const orden = sortAssessments(base, 'severity').map((r) => r.assessmentId);
    expect(orden[orden.length - 1]).toBe('sin');
  });

  it('con sort=recent manda la fecha y la severidad no interviene', () => {
    const conFecha: AssessmentWithSeverity[] = [
      { ...base[0]!, assessmentId: 'vieja', administeredAt: '2026-01-10T00:00:00Z' },
      { ...base[2]!, assessmentId: 'nueva', administeredAt: '2026-09-10T00:00:00Z' },
    ];
    expect(sortAssessments(conFecha, 'recent').map((r) => r.assessmentId)).toEqual([
      'nueva',
      'vieja',
    ]);
  });

  it('una fecha inválida no rompe el orden ni se cuela adelante', () => {
    const rows: AssessmentWithSeverity[] = [
      { ...base[0]!, assessmentId: 'rota', administeredAt: 'no-es-fecha' },
      { ...base[0]!, assessmentId: 'buena', administeredAt: '2026-05-01T00:00:00Z' },
    ];
    expect(sortAssessments(rows, 'recent').map((r) => r.assessmentId)).toEqual(['buena', 'rota']);
  });

  it('no muta el arreglo recibido', () => {
    const original = base.map((r) => r.assessmentId);
    sortAssessments(base, 'severity');
    expect(base.map((r) => r.assessmentId)).toEqual(original);
  });
});
