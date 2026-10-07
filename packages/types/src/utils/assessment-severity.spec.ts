import {
  attachSeverity,
  describeSeverity,
  explainAssessmentSeverity,
  sortAssessments,
  type AssessmentWithSeverity,
} from './assessment-severity';
import type { AssessmentOption } from '../schemas/item-analysis.schema';
import type {
  ComparableUnitAssessment,
  ComparableUnitSummary,
} from '../schemas/comparable-overview.schema';
import type { PerformanceBandView } from '../schemas/performance-band.schema';

const BANDAS_DIAGNOSTICO: PerformanceBandView[] = [
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

function application(
  overrides: Partial<ComparableUnitAssessment> & { assessmentId: string },
): ComparableUnitAssessment {
  return {
    studentsAssessed: 0,
    averageAchievement: null,
    lowestBandCount: null,
    lowestBandShare: null,
    severity: null,
    ...overrides,
  };
}

function assessment(
  overrides: Partial<AssessmentOption> & { assessmentId: string },
): AssessmentOption {
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
    byAssessment: [],
    baseline: null,
    severity: null,
    ...overrides,
  } as ComparableUnitSummary;
}

describe('attachSeverity', () => {
  it('cuelga de cada evaluación SU severidad, no la de la unidad', () => {
    const rows = attachSeverity(
      [assessment({ assessmentId: '7A' }), assessment({ assessmentId: '7B' })],
      [
        unit({
          key: 'u1',
          assessmentIds: ['7A', '7B'],
          severity: 'high',
          bands: BANDAS_DIAGNOSTICO,
          byAssessment: [
            application({ assessmentId: '7A', averageAchievement: 85, severity: 'low' }),
            application({
              assessmentId: '7B',
              averageAchievement: 71.4,
              studentsAssessed: 43,
              lowestBandCount: 32,
              lowestBandShare: 74.4,
              severity: 'high',
            }),
          ],
        }),
      ],
    );

    expect(rows[0]).toMatchObject({ severity: 'low', unitKey: 'u1' });
    expect(rows[1]).toMatchObject({ severity: 'high', lowestBandShare: 74.4, unitKey: 'u1' });
    expect(rows[1]!.severityReason).toContain('71,4%');
    expect(rows[1]!.severityReason).toContain('32 de 43 alumnos');
  });

  it('una evaluación fuera de toda unidad queda no clasificable', () => {
    const rows = attachSeverity(
      [assessment({ assessmentId: 'a1' }), assessment({ assessmentId: 'a2' })],
      [
        unit({
          key: 'u1',
          assessmentIds: ['a1'],
          byAssessment: [application({ assessmentId: 'a1', severity: 'medium' })],
        }),
      ],
    );

    expect(rows[1]).toMatchObject({
      severity: null,
      lowestBandShare: null,
      severityReason: null,
      unitKey: null,
    });
  });

  it('sin unidades, todo queda no clasificable en vez de romper', () => {
    const rows = attachSeverity([assessment({ assessmentId: 'a1' })], []);
    expect(rows[0]!.severity).toBeNull();
  });
});

describe('describeSeverity', () => {
  it('explica el grave con el corte del instrumento y los alumnos en la banda inferior', () => {
    expect(
      describeSeverity({
        severity: 'high',
        averageAchievement: 71.4,
        bands: BANDAS_DIAGNOSTICO,
        studentsAssessed: 43,
        lowestBandCount: 32,
      }),
    ).toBe(
      'El logro promedio (71,4%) cae en «Requiere mayor apoyo», la banda más baja del instrumento (bajo 78,8%). 32 de 43 alumnos quedaron en «Requiere mayor apoyo».',
    );
  });

  it('el leve se explica desde el corte inferior de su banda', () => {
    expect(
      describeSeverity({
        severity: 'low',
        averageAchievement: 82.56,
        bands: BANDAS_DIAGNOSTICO,
        studentsAssessed: 43,
        lowestBandCount: null,
      }),
    ).toBe(
      'El logro promedio (82,6%) cae en «No requiere mayor apoyo», la banda más alta del instrumento (desde 78,8%).',
    );
  });

  it('una banda intermedia da el rango completo', () => {
    const reason = describeSeverity({
      severity: 'medium',
      averageAchievement: 55,
      bands: [
        { key: 'n1', label: 'Nivel I', order: 0, minThreshold: 0, maxThreshold: 0.4 },
        { key: 'n2', label: 'Nivel II', order: 1, minThreshold: 0.4, maxThreshold: 0.76 },
        { key: 'n3', label: 'Nivel III', order: 2, minThreshold: 0.76, maxThreshold: 1 },
      ],
      studentsAssessed: 0,
      lowestBandCount: null,
    });
    expect(reason).toContain('una banda intermedia del instrumento (entre 40% y 76%)');
  });

  it('sin umbrales en las bandas no explica nada', () => {
    expect(
      describeSeverity({
        severity: 'high',
        averageAchievement: 71.4,
        bands: BANDAS_DIAGNOSTICO.map(({ key, label, order }) => ({ key, label, order })),
        studentsAssessed: 43,
        lowestBandCount: 32,
      }),
    ).toBeNull();
  });
});

describe('explainAssessmentSeverity', () => {
  it('calcula la gravedad con la misma regla que la API', () => {
    expect(
      explainAssessmentSeverity({
        averageAchievement: 71.4,
        bands: BANDAS_DIAGNOSTICO,
        studentsAssessed: 43,
        lowestBandCount: 32,
      })?.severity,
    ).toBe('high');
  });

  it('sin bandas no hay gravedad que explicar', () => {
    expect(
      explainAssessmentSeverity({
        averageAchievement: 71.4,
        bands: null,
        studentsAssessed: 43,
        lowestBandCount: 32,
      }),
    ).toBeNull();
  });
});

describe('sortAssessments', () => {
  const base: AssessmentWithSeverity[] = [
    {
      ...assessment({ assessmentId: 'sin', studentsCount: 99 }),
      severity: null,
      lowestBandShare: null,
      severityReason: null,
      unitKey: null,
    },
    {
      ...assessment({ assessmentId: 'media', studentsCount: 10 }),
      severity: 'medium',
      lowestBandShare: 30,
      severityReason: null,
      unitKey: 'u2',
    },
    {
      ...assessment({ assessmentId: 'grave-pocos', studentsCount: 5 }),
      severity: 'high',
      lowestBandShare: 45,
      severityReason: null,
      unitKey: 'u3',
    },
    {
      ...assessment({ assessmentId: 'grave-muchos', studentsCount: 40 }),
      severity: 'high',
      lowestBandShare: 41,
      severityReason: null,
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
