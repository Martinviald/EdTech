import { getTableName } from 'drizzle-orm';
import {
  assessmentResults,
  assessments,
  instruments,
  studentEnrollments,
  students,
  teacherAssignments,
} from '@soe/db';
import type { Database } from '@soe/db';
import type { ComparableUnitClassGroup, PerformanceBandInput, UserRole } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { ComparableUnitAssembler } from '../dashboards/comparable/comparable-unit.assembler';
import { StudentComparisonsService } from './student-comparisons.service';

jest.mock('../performance-bands/lib/resolve-effective-bands', () => ({
  resolveEffectiveBands: jest.fn(async () => ({ bands: DIA_BANDS, source: 'own' })),
}));

const DIA_BANDS: PerformanceBandInput[] = [
  { id: 'b-I', key: 'I', label: 'Nivel I', order: 0, minThreshold: 0, maxThreshold: 0.4 },
  { id: 'b-II', key: 'II', label: 'Nivel II', order: 1, minThreshold: 0.4, maxThreshold: 0.7 },
  { id: 'b-III', key: 'III', label: 'Nivel III', order: 2, minThreshold: 0.7, maxThreshold: 1 },
];

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  const role: UserRole = overrides.activeRole ?? overrides.role ?? 'school_admin';
  return {
    userId: 'user-1',
    orgId: 'org-1',
    email: 't@x.cl',
    name: 'Tester',
    isPlatformAdmin: role === 'platform_admin',
    roles: [role],
    activeRole: role,
    role,
    ...overrides,
  };
}

type Chain = {
  isDistinct: boolean;
  from: unknown;
  joins: number;
};

type Route = (chain: Chain) => unknown[] | undefined;

function tableName(table: unknown): string {
  try {
    return getTableName(table as never);
  } catch {
    return '';
  }
}

function makeDb(route: Route): Database {
  function buildChain(isDistinct: boolean): Record<string, unknown> {
    const state: Chain = { isDistinct, from: null, joins: 0 };
    const chain: Record<string, unknown> = {
      from: (table: unknown) => {
        state.from = table;
        return chain;
      },
      where: () => chain,
      innerJoin: () => {
        state.joins += 1;
        return chain;
      },
      leftJoin: () => chain,
      groupBy: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (rows: unknown[]) => unknown) =>
        Promise.resolve(route(state) ?? []).then(resolve),
    };
    return chain;
  }

  const db = {
    select: () => buildChain(false),
    selectDistinct: () => buildChain(true),
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  } as unknown as Database;

  return db;
}

function makeAssembler(
  coursesByAssessment: Map<string, ComparableUnitClassGroup[]>,
): ComparableUnitAssembler {
  const assembler = {
    loadByClassGroup: async (
      _tx: unknown,
      _orgId: string,
      assessmentIds: string[],
      classGroupIds: string[] | null,
      _bands: PerformanceBandInput[],
    ): Promise<ComparableUnitClassGroup[]> => {
      const courses = assessmentIds.flatMap((id) => coursesByAssessment.get(id) ?? []);
      if (classGroupIds === null) return courses;
      const allowed = new Set(classGroupIds);
      return courses.filter((c) => allowed.has(c.classGroupId));
    },
  };
  return assembler as unknown as ComparableUnitAssembler;
}

function makeService(db: Database, assembler: ComparableUnitAssembler): StudentComparisonsService {
  return new (StudentComparisonsService as new (
    db: Database,
    assembler: ComparableUnitAssembler,
  ) => StudentComparisonsService)(db, assembler);
}

const STUDENT = { id: 'stu-1', firstName: 'Ana', lastName: 'Pérez', rut: '11.111.111-1' };

function studentAssessmentRow(overrides: Record<string, unknown> = {}) {
  return {
    assessmentId: 'a-anchor',
    assessmentName: 'DIA Lectura',
    instrumentId: 'inst-2026',
    instrumentName: 'DIA Lectura 3º 2026',
    instrumentType: 'dia',
    subjectId: 'subj-len',
    subjectName: 'Lenguaje',
    gradeId: 'grade-3',
    year: 2026,
    applicationPeriod: 'diagnostico',
    administeredAt: new Date('2026-03-01'),
    dataGranularity: 'item_level',
    achievement: '80.00',
    grade: '6.00',
    performanceLevel: 'advanced',
    bandKey: 'III',
    bandLabel: 'Nivel III',
    bandOrder: 2,
    bandColor: null,
    priorBandKey: null,
    priorBandLabel: null,
    priorBandOrder: null,
    priorBandColor: null,
    ...overrides,
  };
}

function course(
  classGroupId: string,
  classGroupName: string,
  averageAchievement: number | null,
  studentsAssessed: number,
  gradeName: string | null = '3° básico',
): ComparableUnitClassGroup {
  return {
    classGroupId,
    classGroupName,
    gradeName,
    studentsAssessed,
    averageAchievement,
    lowestBandShare: null,
  };
}

function familyInstrumentRow(instrumentId: string, year: number) {
  return {
    instrumentId,
    type: 'dia',
    subjectId: 'subj-len',
    gradeId: 'grade-3',
    applicationPeriod: 'diagnostico',
    year,
  };
}

type Fixtures = {
  scopeRows?: unknown[];
  studentAssessments: unknown[];
  familyInstruments: unknown[];
  assessmentIdsByCall: string[][];
  studentCourseId: string | null;
  visibilityEnrollment?: unknown[];
};

function makeRoute(fx: Fixtures): Route {
  const assessmentQueue = fx.assessmentIdsByCall.map((ids) => ids.map((id) => ({ id })));
  return (chain) => {
    const table = chain.from;
    if (table === teacherAssignments) return fx.scopeRows ?? [];
    if (table === students) return [STUDENT];
    if (table === assessmentResults) return fx.studentAssessments;
    if (tableName(table) === tableName(instruments) && chain.isDistinct) {
      return fx.familyInstruments;
    }
    if (table === assessments) {
      return assessmentQueue.shift() ?? [];
    }
    if (table === studentEnrollments && chain.joins >= 2) {
      return fx.studentCourseId ? [{ classGroupId: fx.studentCourseId }] : [];
    }
    if (table === studentEnrollments) {
      return fx.visibilityEnrollment ?? [{ id: 'enr-1', classGroupId: fx.studentCourseId }];
    }
    return [];
  };
}

describe('StudentComparisonsService', () => {
  it('compara al alumno contra su curso, su nivel y una generación anterior', async () => {
    const coursesByAssessment = new Map<string, ComparableUnitClassGroup[]>([
      ['a-anchor', [course('cg-3a-2026', '3°A', 70, 25), course('cg-3b-2026', '3°B', 50, 15)]],
      ['a-2024', [course('cg-3a-2024', '3°A', 60, 20), course('cg-3b-2024', '3°B', 40, 20)]],
    ]);

    const route = makeRoute({
      studentAssessments: [studentAssessmentRow()],
      familyInstruments: [
        familyInstrumentRow('inst-2026', 2026),
        familyInstrumentRow('inst-2024', 2024),
      ],
      assessmentIdsByCall: [['a-anchor'], ['a-2024']],
      studentCourseId: 'cg-3a-2026',
    });

    const result = await makeService(
      makeDb(route),
      makeAssembler(coursesByAssessment),
    ).getComparisons(makeUser(), 'stu-1');

    expect(result.scope).toBe('org');
    expect(result.subjects).toHaveLength(1);

    const subject = result.subjects[0]!;
    expect(subject.subjectName).toBe('Lenguaje');
    expect(subject.anchor.instrumentId).toBe('inst-2026');
    expect(subject.anchor.year).toBe(2026);
    expect(subject.anchor.label).toBe('Diagnóstico 2026');
    expect(subject.student.achievement).toBe(80);
    expect(subject.student.performanceBand?.key).toBe('III');

    expect(subject.course).toEqual({
      label: '3°A',
      achievement: 70,
      studentsAssessed: 25,
      deltaPp: 10,
    });

    expect(subject.grade?.label).toBe('3° básico');
    expect(subject.grade?.studentsAssessed).toBe(40);
    expect(subject.grade?.achievement).toBeCloseTo((70 * 25 + 50 * 15) / 40, 5);
    expect(subject.grade?.deltaPp).toBeCloseTo(80 - (70 * 25 + 50 * 15) / 40, 1);

    expect(subject.generations).toHaveLength(1);
    const gen = subject.generations[0]!;
    expect(gen.label).toBe('2024');
    expect(gen.studentsAssessed).toBe(40);
    expect(gen.achievement).toBeCloseTo((60 * 20 + 40 * 20) / 40, 5);
    expect(gen.deltaPp).toBeCloseTo(80 - 50, 1);
  });

  it('devuelve generations vacío cuando no hay años anteriores', async () => {
    const coursesByAssessment = new Map<string, ComparableUnitClassGroup[]>([
      ['a-anchor', [course('cg-3a-2026', '3°A', 70, 25)]],
    ]);

    const route = makeRoute({
      studentAssessments: [studentAssessmentRow()],
      familyInstruments: [familyInstrumentRow('inst-2026', 2026)],
      assessmentIdsByCall: [['a-anchor']],
      studentCourseId: 'cg-3a-2026',
    });

    const result = await makeService(
      makeDb(route),
      makeAssembler(coursesByAssessment),
    ).getComparisons(makeUser(), 'stu-1');

    const subject = result.subjects[0]!;
    expect(subject.generations).toEqual([]);
    expect(subject.course?.label).toBe('3°A');
    expect(subject.grade?.studentsAssessed).toBe(25);
    expect(subject.grade?.achievement).toBe(70);
  });

  it('acota las cohortes a los cursos del profesor y reporta scope teacher', async () => {
    const coursesByAssessment = new Map<string, ComparableUnitClassGroup[]>([
      ['a-anchor', [course('cg-3a-2026', '3°A', 70, 25), course('cg-3b-2026', '3°B', 50, 15)]],
    ]);

    const route = makeRoute({
      scopeRows: [{ classGroupId: 'cg-3a-2026', subjectId: 'subj-len' }],
      studentAssessments: [studentAssessmentRow()],
      familyInstruments: [familyInstrumentRow('inst-2026', 2026)],
      assessmentIdsByCall: [['a-anchor']],
      studentCourseId: 'cg-3a-2026',
      visibilityEnrollment: [{ id: 'enr-1', classGroupId: 'cg-3a-2026' }],
    });

    const result = await makeService(
      makeDb(route),
      makeAssembler(coursesByAssessment),
    ).getComparisons(makeUser({ activeRole: 'teacher' }), 'stu-1');

    expect(result.scope).toBe('teacher');
    const subject = result.subjects[0]!;
    expect(subject.course).toEqual({
      label: '3°A',
      achievement: 70,
      studentsAssessed: 25,
      deltaPp: 10,
    });
    expect(subject.grade?.studentsAssessed).toBe(25);
    expect(subject.grade?.achievement).toBe(70);
  });
});
