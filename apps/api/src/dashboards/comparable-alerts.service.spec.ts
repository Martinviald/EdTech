import type { Database } from '@soe/db';
import type { ComparableUnitSummary, InstrumentSample } from '@soe/types';
import { ComparableAlertsService } from './comparable-alerts.service';

// Las familias que se calculan EN MEMORIA a partir de las unidades (concentración en
// banda, movimiento contra el baseline, curso bajo su propia unidad) se pueden probar
// sin base: el fake sólo tiene que devolver vacío para las que sí consultan.
function makeDb(): Database {
  const chain = {
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
    as: () => chain,
    offset: () => chain,
    then: <T>(resolve: (rows: T[]) => unknown) =>
      Promise.resolve([] as never).then(resolve as never),
  };
  return {
    select: () => chain,
    selectDistinct: () => chain,
  } as unknown as Database;
}

function makeUnit(overrides: Partial<ComparableUnitSummary> = {}): ComparableUnitSummary {
  return {
    key: 'i1',
    instrumentId: 'i1',
    instrumentName: 'DIA Matemática 8°',
    instrumentType: 'dia',
    subjectId: 's1',
    subjectName: 'Matemática',
    gradeId: 'g8',
    gradeName: '8° Básico',
    applicationPeriod: 'cierre',
    year: 2026,
    assessmentIds: ['a1'],
    lastAdministeredAt: null,
    studentsAssessed: 100,
    averageAchievement: 60,
    bands: [{ key: 'nivel_1', label: 'Nivel I', order: 0, color: null }],
    bandDistribution: null,
    levelDistribution: null,
    lowestBandShare: null,
    byClassGroup: [],
    baseline: null,
    severity: null,
    ...overrides,
  };
}

const svc = new ComparableAlertsService();

describe('ComparableAlertsService — familia A (nivel)', () => {
  it('alerta por concentración en la banda INFERIOR del instrumento, no por un corte de logro', async () => {
    const unit = makeUnit({
      byClassGroup: [
        {
          classGroupId: 'cg1',
          classGroupName: '8°B',
          gradeName: '8° Básico',
          studentsAssessed: 30,
          averageAchievement: 55,
          lowestBandShare: 62,
        },
      ],
    });

    const alerts = await svc.deriveAlerts(makeDb(), 'org-1', [unit], null);
    const alert = alerts.find((a) => a.type === 'band_concentration')!;

    expect(alert.severity).toBe('high');
    expect(alert.message).toContain('62%');
    expect(alert.message).toContain('Nivel I');
    expect(alert.contextKind).toBe('class_group');
    expect(alert.unitKey).toBe('i1');
    // 62% de 30 alumnos.
    expect(alert.studentsAffected).toBe(19);
  });

  it('un curso con poca concentración en la banda inferior NO genera alerta', async () => {
    const unit = makeUnit({
      byClassGroup: [
        {
          classGroupId: 'cg1',
          classGroupName: '8°A',
          gradeName: null,
          studentsAssessed: 30,
          averageAchievement: 55,
          lowestBandShare: 10,
        },
      ],
    });

    const alerts = await svc.deriveAlerts(makeDb(), 'org-1', [unit], null);
    expect(alerts.filter((a) => a.type === 'band_concentration')).toHaveLength(0);
  });
});

describe('ComparableAlertsService — familia B (movimiento)', () => {
  it('una caída contra el año anterior alerta, y dice cuántos pp', async () => {
    const unit = makeUnit({
      baseline: {
        kind: 'previous_year',
        label: 'DIA Matemática 8° 2025',
        instrumentId: 'i0',
        assessmentIds: ['a0'],
        achievement: 72,
        deltaPp: -12,
      },
    });

    const alerts = await svc.deriveAlerts(makeDb(), 'org-1', [unit], null);
    const alert = alerts.find((a) => a.type === 'drop_vs_previous_year')!;

    expect(alert.severity).toBe('high');
    expect(alert.message).toContain('12.0 pp');
    expect(alert.value).toBe(-12);
  });

  it('una SUBIDA no genera alerta', async () => {
    const unit = makeUnit({
      baseline: {
        kind: 'previous_year',
        label: 'DIA Matemática 8° 2025',
        instrumentId: 'i0',
        assessmentIds: ['a0'],
        achievement: 50,
        deltaPp: 10,
      },
    });

    const alerts = await svc.deriveAlerts(makeDb(), 'org-1', [unit], null);
    expect(alerts.filter((a) => a.type.startsWith('drop_vs'))).toHaveLength(0);
  });

  it('la caída entre momentos del mismo año se distingue de la interanual', async () => {
    const unit = makeUnit({
      baseline: {
        kind: 'previous_period',
        label: 'Monitoreo 2026',
        instrumentId: 'i0',
        assessmentIds: ['a0'],
        achievement: 70,
        deltaPp: -7,
      },
    });

    const alerts = await svc.deriveAlerts(makeDb(), 'org-1', [unit], null);
    expect(alerts.some((a) => a.type === 'drop_vs_previous_period')).toBe(true);
  });

  it('un curso bajo el promedio de su PROPIA unidad alerta (no contra otro instrumento)', async () => {
    const unit = makeUnit({
      averageAchievement: 60,
      byClassGroup: [
        {
          classGroupId: 'cg1',
          classGroupName: '8°A',
          gradeName: null,
          studentsAssessed: 30,
          averageAchievement: 42,
          lowestBandShare: null,
        },
        {
          classGroupId: 'cg2',
          classGroupName: '8°B',
          gradeName: null,
          studentsAssessed: 30,
          averageAchievement: 78,
          lowestBandShare: null,
        },
      ],
    });

    const alerts = await svc.deriveAlerts(makeDb(), 'org-1', [unit], null);
    const belowOrg = alerts.filter((a) => a.type === 'class_below_org');

    expect(belowOrg).toHaveLength(1);
    expect(belowOrg[0]!.contextId).toBe('cg1');
    expect(belowOrg[0]!.severity).toBe('high');
  });

  it('con un solo curso no tiene sentido compararlo contra "el resto"', async () => {
    const unit = makeUnit({
      averageAchievement: 60,
      byClassGroup: [
        {
          classGroupId: 'cg1',
          classGroupName: '8°A',
          gradeName: null,
          studentsAssessed: 30,
          averageAchievement: 30,
          lowestBandShare: null,
        },
      ],
    });

    const alerts = await svc.deriveAlerts(makeDb(), 'org-1', [unit], null);
    expect(alerts.filter((a) => a.type === 'class_below_org')).toHaveLength(0);
  });
});

describe('ComparableAlertsService — prioridad y dedup', () => {
  it('ordena por severidad y, a igual severidad, por alumnos afectados', async () => {
    const unit = makeUnit({
      averageAchievement: 60,
      baseline: {
        kind: 'previous_year',
        label: '2025',
        instrumentId: 'i0',
        assessmentIds: ['a0'],
        achievement: 66,
        deltaPp: -6,
      },
      byClassGroup: [
        {
          classGroupId: 'cg1',
          classGroupName: 'Curso chico',
          gradeName: null,
          studentsAssessed: 10,
          averageAchievement: 40,
          lowestBandShare: 50,
        },
        {
          classGroupId: 'cg2',
          classGroupName: 'Curso grande',
          gradeName: null,
          studentsAssessed: 100,
          averageAchievement: 40,
          lowestBandShare: 50,
        },
      ],
    });

    const alerts = await svc.deriveAlerts(makeDb(), 'org-1', [unit], null);

    expect(alerts[0]!.severity).toBe('high');
    const concentration = alerts.filter((a) => a.type === 'band_concentration');
    // A igual severidad manda el volumen: el curso grande primero.
    expect(concentration[0]!.contextLabel).toBe('Curso grande');
    // La caída de 6 pp es 'medium', así que va después de las 'high'.
    const drop = alerts.findIndex((a) => a.type === 'drop_vs_previous_year');
    expect(drop).toBeGreaterThan(0);
  });

  it('cada alerta trae una clave estable de dedup, y no se emite dos veces la misma', async () => {
    const unit = makeUnit({
      byClassGroup: [
        {
          classGroupId: 'cg1',
          classGroupName: '8°B',
          gradeName: null,
          studentsAssessed: 30,
          averageAchievement: 40,
          lowestBandShare: 62,
        },
      ],
    });

    const alerts = await svc.deriveAlerts(makeDb(), 'org-1', [unit, { ...unit }], null);
    const keys = alerts.map((a) => a.dedupKey);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('band_concentration:i1:cg1');
  });
});

function makeSample(overrides: Partial<InstrumentSample> = {}): InstrumentSample {
  return {
    instrumentId: 'i1',
    scope: 'global',
    label: 'Muestra',
    schoolCount: 12,
    studentCount: 900,
    avgAchievement: 66,
    p10: 52,
    p25: 58,
    median: 65,
    p75: 72,
    bandCounts: [],
    perSkill: [],
    refreshedAt: '2026-10-05T06:30:00.000Z',
    ...overrides,
  };
}

function samplesFor(sample: InstrumentSample | null, percentile: number | null = 20) {
  return new Map([
    [
      'i1',
      {
        instrumentId: 'i1',
        global: sample,
        network: null,
        you: { avgAchievement: 60, studentCount: 100, percentile, typicalZone: 'below' as const },
      },
    ],
  ]);
}

function course(id: string, averageAchievement: number | null) {
  return {
    classGroupId: id,
    classGroupName: id,
    gradeName: null,
    studentsAssessed: 30,
    averageAchievement,
    lowestBandShare: null,
  };
}

describe('ComparableAlertsService — alertas relativas a la muestra', () => {
  it('sin muestras no emite alertas relativas y marca la base de las existentes', async () => {
    const unit = makeUnit({ averageAchievement: 40 });

    const alerts = await svc.deriveAlerts(makeDb(), 'org-1', [unit], null);

    expect(alerts.some((a) => a.basis === 'cohort')).toBe(false);
    expect(alerts.every((a) => a.cohort === null)).toBe(true);
  });

  it('exige posición y magnitud: bajo el p25 pero a menos de 5 pp no alerta', async () => {
    const unit = makeUnit({ averageAchievement: 57 });

    const alerts = await svc.deriveAlerts(
      makeDb(),
      'org-1',
      [unit],
      null,
      samplesFor(makeSample({ avgAchievement: 60, p25: 58 })),
    );

    expect(alerts.filter((a) => a.type === 'below_sample')).toHaveLength(0);
  });

  it('bajo el p25 y 5 pp o más bajo la muestra es medium', async () => {
    const unit = makeUnit({ averageAchievement: 57 });

    const alerts = await svc.deriveAlerts(
      makeDb(),
      'org-1',
      [unit],
      null,
      samplesFor(makeSample()),
    );
    const alert = alerts.find((a) => a.type === 'below_sample');

    expect(alert).toMatchObject({
      severity: 'medium',
      basis: 'cohort',
      value: 57,
      cohort: {
        sampleValue: 66,
        schoolCount: 12,
        studentCount: 900,
        percentile: 20,
        similarToSample: false,
      },
    });
    expect(alert!.message).toContain('bajo la zona típica de la muestra (58.0–72.0%)');
  });

  it('bajo el p10 y 10 pp o más bajo la muestra es high', async () => {
    const unit = makeUnit({ averageAchievement: 50 });

    const alerts = await svc.deriveAlerts(
      makeDb(),
      'org-1',
      [unit],
      null,
      samplesFor(makeSample()),
    );

    expect(alerts.find((a) => a.type === 'below_sample')!.severity).toBe('high');
  });

  it('con dos colegios el más bajo sólo alerta si la diferencia es material', async () => {
    const twoSchools = makeSample({
      schoolCount: 2,
      studentCount: 103,
      avgAchievement: 71.91,
      p10: 71.75,
      p25: 72.07,
      p75: 73.16,
    });

    const close = await svc.deriveAlerts(
      makeDb(),
      'org-1',
      [makeUnit({ averageAchievement: 71.53 })],
      null,
      samplesFor(twoSchools),
    );
    expect(close.filter((a) => a.basis === 'cohort')).toHaveLength(0);
  });

  it('alerta por curso bajo la muestra sólo cuando la unidad tiene más de un curso', async () => {
    const single = makeUnit({ averageAchievement: 70, byClassGroup: [course('8°A', 50)] });
    const several = makeUnit({
      averageAchievement: 70,
      byClassGroup: [course('8°A', 50), course('8°B', 75)],
    });

    const onlyOne = await svc.deriveAlerts(
      makeDb(),
      'org-1',
      [single],
      null,
      samplesFor(makeSample()),
    );
    const many = await svc.deriveAlerts(
      makeDb(),
      'org-1',
      [several],
      null,
      samplesFor(makeSample()),
    );

    expect(onlyOne.filter((a) => a.type === 'class_below_sample')).toHaveLength(0);
    const courseAlerts = many.filter((a) => a.type === 'class_below_sample');
    expect(courseAlerts).toHaveLength(1);
    expect(courseAlerts[0]).toMatchObject({
      severity: 'high',
      contextKind: 'class_group',
      contextId: '8°A',
      cohort: { percentile: null },
    });
  });

  it('una muestra suprimida por k-anonimato no genera alertas', async () => {
    const alerts = await svc.deriveAlerts(
      makeDb(),
      'org-1',
      [makeUnit({ averageAchievement: 30 })],
      null,
      samplesFor(null),
    );

    expect(alerts.filter((a) => a.basis === 'cohort')).toHaveLength(0);
  });
});
