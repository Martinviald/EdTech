import { BadRequestException, NotFoundException } from '@nestjs/common';
import { resolveEffectiveBandsForInstruments, type EffectiveBands } from '@soe/db';
import type { AssessmentComparisonQueryDto, PerformanceBandInput } from '@soe/types';
import { resolveClassGroupScope } from '../common/helpers/class-group-scope.helper';
import { makeQueueDb, makeScope, makeScopedUser } from '../common/helpers/scope-test-utils';
import { AssessmentComparisonsService } from './assessment-comparisons.service';

jest.mock('@soe/db', () => ({
  ...jest.requireActual('@soe/db'),
  resolveEffectiveBandsForInstruments: jest.fn(),
}));
jest.mock('../common/helpers/class-group-scope.helper', () => ({
  ...jest.requireActual('../common/helpers/class-group-scope.helper'),
  resolveClassGroupScope: jest.fn(),
}));

const mockedScope = jest.mocked(resolveClassGroupScope);
const mockedBands = jest.mocked(resolveEffectiveBandsForInstruments);

const BASE = '00000000-0000-0000-0000-0000000000a1';
const COMPARISON = '00000000-0000-0000-0000-0000000000a2';
const SUBJECT = 'subject-lang';
const CG1 = 'cg-1';
const CG2 = 'cg-2';

function bandSet(prefix: string, count: number): PerformanceBandInput[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-id-${index}`,
    key: `${prefix}${index + 1}`,
    label: `Nivel ${index + 1}`,
    order: index,
    minThreshold: index / count,
    maxThreshold: (index + 1) / count,
  }));
}

function meta(overrides: Record<string, unknown>) {
  return {
    assessmentId: BASE,
    assessmentName: 'Diagnóstico',
    administeredAt: new Date('2026-03-10T00:00:00Z'),
    instrumentId: 'instr-1',
    instrumentName: 'Lectura 4° básico',
    type: 'dia',
    subjectId: SUBJECT,
    gradeId: 'grade-4',
    applicationPeriod: 'diagnostico',
    year: 2026,
    trackId: null,
    ...overrides,
  };
}

const baseMeta = meta({});
const comparisonMeta = meta({
  assessmentId: COMPARISON,
  assessmentName: 'Cierre',
  instrumentId: 'instr-2',
  instrumentName: 'Lectura 4° básico cierre',
  applicationPeriod: 'cierre',
  administeredAt: new Date('2026-11-10T00:00:00Z'),
});

function result(
  assessmentId: string,
  studentId: string,
  overrides: Partial<{
    classGroupId: string;
    totalScore: string | null;
    maxScore: string | null;
    percentage: string | null;
    metricType: string;
    performanceBandId: string | null;
  }> = {},
) {
  return {
    assessmentId,
    studentId,
    classGroupId: CG1,
    totalScore: null,
    maxScore: null,
    percentage: null,
    metricType: 'percentage',
    performanceBandId: null,
    ...overrides,
  };
}

function scored(assessmentId: string, studentId: string, total: number, max: number) {
  return result(assessmentId, studentId, {
    totalScore: String(total),
    maxScore: String(max),
    percentage: String((total / max) * 100),
  });
}

function courses(...assessmentIds: string[]) {
  return assessmentIds.flatMap((assessmentId) => [
    { assessmentId, classGroupId: CG1 },
    { assessmentId, classGroupId: CG2 },
  ]);
}

function query(
  overrides: Partial<AssessmentComparisonQueryDto> = {},
): AssessmentComparisonQueryDto {
  return {
    baseAssessmentId: BASE,
    comparisonAssessmentId: COMPARISON,
    cohort: 'paired',
    ...overrides,
  };
}

function useBands(baseBands: PerformanceBandInput[], comparisonBands: PerformanceBandInput[]) {
  mockedBands.mockResolvedValue(
    new Map<string, EffectiveBands>([
      ['instr-1', { bands: baseBands, source: 'own' }],
      ['instr-2', { bands: comparisonBands, source: 'own' }],
    ]),
  );
}

function makeService(results: unknown[][]) {
  const db = makeQueueDb(results);
  return { db, service: new AssessmentComparisonsService(db) };
}

const admin = makeScopedUser({ activeRole: 'school_admin', roles: ['school_admin'] });

beforeEach(() => {
  mockedScope.mockReset();
  mockedBands.mockReset();
  mockedScope.mockResolvedValue(makeScope({ scopeAll: true }));
  useBands(bandSet('n', 3), bandSet('m', 3));
});

describe('AssessmentComparisonsService.compare', () => {
  it('rechaza con 400 dos evaluaciones cuyos instrumentos no son comparables', async () => {
    const { service } = makeService([[baseMeta, meta({ ...comparisonMeta, gradeId: 'grade-5' })]]);

    await expect(service.compare(admin, query())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza con 400 dos líneas de prueba distintas de la misma asignatura', async () => {
    const { service } = makeService([
      [meta({ trackId: 'track-m1' }), meta({ ...comparisonMeta, trackId: 'track-m2' })],
    ]);

    await expect(service.compare(admin, query())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza con 400 la misma evaluación en ambos lados', async () => {
    const { service } = makeService([]);

    await expect(
      service.compare(admin, query({ comparisonAssessmentId: BASE })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('responde 404 si una de las evaluaciones no existe en la org', async () => {
    const { service } = makeService([[baseMeta]]);

    await expect(service.compare(admin, query())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('responde 404 si una evaluación no tiene cursos dentro del alcance docente', async () => {
    mockedScope.mockResolvedValue(
      makeScope({ pairs: [{ classGroupId: CG1, subjectId: SUBJECT }] }),
    );
    const { service } = makeService([
      [baseMeta, comparisonMeta],
      [
        { assessmentId: BASE, classGroupId: CG1 },
        { assessmentId: COMPARISON, classGroupId: CG2 },
      ],
    ]);

    await expect(service.compare(admin, query())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('acota estudiantes, logro y nodos a los cursos del alcance docente', async () => {
    mockedScope.mockResolvedValue(
      makeScope({ pairs: [{ classGroupId: CG1, subjectId: SUBJECT }] }),
    );
    const teacher = makeScopedUser();
    const { service } = makeService([
      [baseMeta, comparisonMeta],
      courses(BASE, COMPARISON),
      [
        scored(BASE, 's1', 5, 10),
        { ...scored(BASE, 's9', 10, 10), classGroupId: CG2 },
        scored(COMPARISON, 's2', 6, 10),
        { ...scored(COMPARISON, 's8', 10, 10), classGroupId: CG2 },
      ],
      [
        { assessmentId: BASE, classGroupId: CG1, scoreSum: '20', maxSum: '40', students: 4 },
        { assessmentId: BASE, classGroupId: CG2, scoreSum: '40', maxSum: '40', students: 4 },
        { assessmentId: COMPARISON, classGroupId: CG1, scoreSum: '30', maxSum: '40', students: 4 },
        { assessmentId: COMPARISON, classGroupId: CG2, scoreSum: '40', maxSum: '40', students: 4 },
      ],
      [
        {
          assessmentId: BASE,
          classGroupId: CG1,
          nodeId: 'n-a',
          nodeName: 'Localizar',
          nodeType: 'skill',
          scoreSum: '5',
          maxSum: '10',
        },
        {
          assessmentId: BASE,
          classGroupId: CG2,
          nodeId: 'n-a',
          nodeName: 'Localizar',
          nodeType: 'skill',
          scoreSum: '10',
          maxSum: '10',
        },
        {
          assessmentId: COMPARISON,
          classGroupId: CG1,
          nodeId: 'n-a',
          nodeName: 'Localizar',
          nodeType: 'skill',
          scoreSum: '8',
          maxSum: '10',
        },
      ],
    ]);

    const response = await service.compare(teacher, query({ cohort: 'all' }));

    expect(response.base.studentsAssessed).toBe(1);
    expect(response.comparison.studentsAssessed).toBe(1);
    expect(response.base.achievementPct).toBe(50);
    expect(response.base.achievementStudents).toBe(4);
    expect(response.comparison.achievementPct).toBe(75);
    expect(response.nodes).toHaveLength(1);
    expect(response.nodes[0]!.baseAchievementPct).toBe(50);
    expect(response.nodes[0]!.comparisonAchievementPct).toBe(80);
    expect(response.nodes[0]!.deltaPp).toBeCloseTo(30);
  });

  it('parea estudiantes y cuenta transiciones y movimiento entre niveles', async () => {
    const { service } = makeService([
      [baseMeta, comparisonMeta],
      courses(BASE, COMPARISON),
      [
        scored(BASE, 's1', 2, 10),
        scored(BASE, 's2', 5, 10),
        scored(BASE, 's3', 9, 10),
        scored(BASE, 's4', 9, 10),
        scored(COMPARISON, 's1', 5, 10),
        scored(COMPARISON, 's2', 5, 10),
        scored(COMPARISON, 's3', 5, 10),
      ],
      [],
    ]);

    const response = await service.compare(admin, query());

    expect(response.cohort).toBe('paired');
    expect(response.fellBackToAll).toBe(false);
    expect(response.pairedStudents).toBe(3);
    expect(response.base.studentsAssessed).toBe(4);
    expect(response.base.bandStudents).toBe(3);
    expect(response.base.bandDistribution.map((c) => c.count)).toEqual([1, 1, 1]);
    expect(response.comparison.bandDistribution.map((c) => c.count)).toEqual([0, 3, 0]);
    expect(response.transitions).toEqual([
      { fromBandKey: 'n1', toBandKey: 'm2', count: 1 },
      { fromBandKey: 'n2', toBandKey: 'm2', count: 1 },
      { fromBandKey: 'n3', toBandKey: 'm2', count: 1 },
    ]);
    expect(response.movement).toEqual({ improved: 1, same: 1, declined: 1 });
    expect(response.base.achievementPct).toBeCloseTo((16 / 30) * 100);
    expect(response.base.achievementStudents).toBe(3);
  });

  it('calcula el % de logro sumando puntajes, no promediando porcentajes', async () => {
    const { service } = makeService([
      [baseMeta, comparisonMeta],
      courses(BASE, COMPARISON),
      [
        scored(BASE, 's1', 1, 2),
        scored(BASE, 's2', 9, 10),
        scored(COMPARISON, 's1', 1, 2),
        scored(COMPARISON, 's2', 9, 10),
      ],
      [],
    ]);

    const response = await service.compare(admin, query());

    expect(response.base.achievementPct).toBeCloseTo((10 / 12) * 100);
    expect(response.base.achievementPct).not.toBeCloseTo(70);
  });

  it('compara las cohortes completas cuando la pareada queda vacía', async () => {
    const { db, service } = makeService([
      [baseMeta, comparisonMeta],
      courses(BASE, COMPARISON),
      [scored(BASE, 's1', 4, 10), scored(COMPARISON, 's2', 6, 10)],
      [
        { assessmentId: BASE, classGroupId: CG1, scoreSum: '4', maxSum: '10', students: 1 },
        { assessmentId: COMPARISON, classGroupId: CG1, scoreSum: '6', maxSum: '10', students: 1 },
      ],
      [],
    ]);

    const response = await service.compare(admin, query({ cohort: 'paired' }));

    expect(response.fellBackToAll).toBe(true);
    expect(response.cohort).toBe('all');
    expect(response.pairedStudents).toBe(0);
    expect(response.base.achievementPct).toBe(40);
    expect(response.comparison.achievementPct).toBe(60);
    expect(response.base.bandStudents).toBe(1);
    expect(response.transitions).toEqual([]);
    expect(db.__remaining()).toBe(0);
  });

  it('usa las bandas de cada instrumento y no calcula movimiento si difieren en niveles', async () => {
    useBands(bandSet('n', 3), bandSet('c', 4));
    const { service } = makeService([
      [baseMeta, comparisonMeta],
      courses(BASE, COMPARISON),
      [scored(BASE, 's1', 5, 10), scored(COMPARISON, 's1', 8, 10)],
      [],
    ]);

    const response = await service.compare(admin, query());

    expect(response.base.bands.map((b) => b.key)).toEqual(['n1', 'n2', 'n3']);
    expect(response.comparison.bands.map((b) => b.key)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(response.transitions).toEqual([{ fromBandKey: 'n2', toBandKey: 'c4', count: 1 }]);
    expect(response.movement).toBeNull();
  });

  it('clasifica evaluaciones aggregate_only por su banda guardada aunque no tengan puntaje', async () => {
    const baseBands = bandSet('n', 3);
    const comparisonBands = bandSet('m', 3);
    useBands(baseBands, comparisonBands);
    const bandRow = (assessmentId: string, studentId: string, bandId: string) =>
      result(assessmentId, studentId, {
        metricType: 'band',
        percentage: '95',
        performanceBandId: bandId,
      });
    const { service } = makeService([
      [baseMeta, comparisonMeta],
      courses(BASE, COMPARISON),
      [
        bandRow(BASE, 's1', baseBands[0]!.id),
        bandRow(BASE, 's2', baseBands[0]!.id),
        bandRow(COMPARISON, 's1', comparisonBands[2]!.id),
        bandRow(COMPARISON, 's2', comparisonBands[0]!.id),
      ],
      [],
    ]);

    const response = await service.compare(admin, query());

    expect(response.base.achievementPct).toBeNull();
    expect(response.base.achievementStudents).toBe(0);
    expect(response.base.bandDistribution.map((c) => c.count)).toEqual([2, 0, 0]);
    expect(response.comparison.bandDistribution.map((c) => c.count)).toEqual([1, 0, 1]);
    expect(response.movement).toEqual({ improved: 1, same: 1, declined: 0 });
  });

  it('sólo devuelve los nodos evaluados en ambas evaluaciones', async () => {
    const { service } = makeService([
      [baseMeta, comparisonMeta],
      courses(BASE, COMPARISON),
      [scored(BASE, 's1', 5, 10), scored(COMPARISON, 's1', 5, 10)],
      [
        {
          assessmentId: BASE,
          classGroupId: CG1,
          nodeId: 'shared',
          nodeName: 'Inferir',
          nodeType: 'skill',
          scoreSum: '3',
          maxSum: '4',
        },
        {
          assessmentId: BASE,
          classGroupId: CG1,
          nodeId: 'only-base',
          nodeName: 'Reflexionar',
          nodeType: 'skill',
          scoreSum: '1',
          maxSum: '4',
        },
        {
          assessmentId: COMPARISON,
          classGroupId: CG1,
          nodeId: 'shared',
          nodeName: 'Inferir',
          nodeType: 'skill',
          scoreSum: '1',
          maxSum: '4',
        },
      ],
    ]);

    const response = await service.compare(admin, query());

    expect(response.nodes).toEqual([
      {
        nodeId: 'shared',
        nodeName: 'Inferir',
        nodeType: 'skill',
        baseAchievementPct: 75,
        comparisonAchievementPct: 25,
        deltaPp: -50,
      },
    ]);
  });
});

describe('AssessmentComparisonsService.listCandidates', () => {
  it('lista evaluaciones comparables con resultados, ordenadas por fecha descendente', async () => {
    const older = meta({
      assessmentId: 'older',
      instrumentId: 'instr-old',
      administeredAt: new Date('2025-11-01T00:00:00Z'),
    });
    const newer = meta({
      assessmentId: 'newer',
      instrumentId: 'instr-new',
      administeredAt: new Date('2026-11-01T00:00:00Z'),
    });
    const otherTrack = meta({ assessmentId: 'other-track', trackId: 'track-x' });
    const withoutResults = meta({ assessmentId: 'empty' });
    const { service } = makeService([
      [baseMeta],
      [{ assessmentId: BASE, classGroupId: CG1 }],
      [older, otherTrack, newer, withoutResults],
      [
        { assessmentId: BASE, students: 30 },
        { assessmentId: 'older', students: 28 },
        { assessmentId: 'newer', students: 31 },
        { assessmentId: 'other-track', students: 12 },
      ],
    ]);

    const response = await service.listCandidates(admin, { baseAssessmentId: BASE });

    expect(response.base.assessmentId).toBe(BASE);
    expect(response.base.studentsAssessed).toBe(30);
    expect(response.data.map((c) => c.assessmentId)).toEqual(['newer', 'older']);
    expect(response.data[0]!.appliedAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('responde 404 si la base no tiene cursos dentro del alcance docente', async () => {
    mockedScope.mockResolvedValue(
      makeScope({ pairs: [{ classGroupId: CG1, subjectId: SUBJECT }] }),
    );
    const { service } = makeService([[baseMeta], [{ assessmentId: BASE, classGroupId: CG2 }]]);

    await expect(
      service.listCandidates(makeScopedUser(), { baseAssessmentId: BASE }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
