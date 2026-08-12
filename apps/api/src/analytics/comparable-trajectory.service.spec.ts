import type { UserRole } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { Database } from '../database/database.types';
import type { ComparableUnitAssembler } from '../dashboards/comparable/comparable-unit.assembler';
import { ComparableTrajectoryService } from './comparable-trajectory.service';

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  const role: UserRole = overrides.activeRole ?? 'school_admin';
  return {
    userId: 'user-1',
    orgId: 'org-1',
    email: 't@x.cl',
    name: 'Tester',
    isPlatformAdmin: false,
    roles: [role],
    activeRole: role,
    role,
    ...overrides,
  };
}

type QueryBuilder = {
  from: (..._: unknown[]) => QueryBuilder;
  where: (..._: unknown[]) => QueryBuilder;
  innerJoin: (..._: unknown[]) => QueryBuilder;
  leftJoin: (..._: unknown[]) => QueryBuilder;
  groupBy: (..._: unknown[]) => QueryBuilder;
  orderBy: (..._: unknown[]) => QueryBuilder;
  limit: (..._: unknown[]) => QueryBuilder;
  then: <T>(resolve: (rows: T[]) => unknown) => Promise<unknown>;
};

function makeDb(selectResults: unknown[][]): Database {
  let selectIdx = 0;

  function buildSelectChain(rows: unknown[]): QueryBuilder {
    const chain: QueryBuilder = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      groupBy: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve) => Promise.resolve(rows as never).then(resolve as never),
    };
    return chain;
  }

  const db = {
    select: () => {
      const rows = selectResults[selectIdx] ?? [];
      selectIdx++;
      return buildSelectChain(rows);
    },
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  } as unknown as Database;

  return db;
}

type AssemblerSpy = { scopedClassGroupIds: (string[] | null)[] };

function makeAssembler(spy: AssemblerSpy = { scopedClassGroupIds: [] }): ComparableUnitAssembler {
  return {
    loadAchievementByAssessment: async (
      _tx: unknown,
      _ids: string[],
      classGroupIds: string[] | null,
    ) => {
      spy.scopedClassGroupIds.push(classGroupIds);
      return new Map();
    },
    foldAchievement: (assessmentIds: string[]) => ({
      achievement: assessmentIds.length > 0 ? 50 : null,
      students: assessmentIds.length * 10,
    }),
    resolveBandDistribution: async () => null,
    loadByClassGroup: async () => [],
    loadBaselineCandidates: async () => new Map(),
    resolveBaselineChoices: () => ({ previousPeriod: null, previousYear: null }),
    baselineAchievement: async () => null,
  } as unknown as ComparableUnitAssembler;
}

const GRADE = [{ name: '5º básico' }];
const SUBJECT = [{ name: 'Lenguaje' }];

function familyRow(
  assessmentId: string,
  year: number,
  applicationPeriod: 'diagnostico' | 'intermedio' | 'cierre',
) {
  return {
    assessmentId,
    instrumentId: `inst-${year}-${applicationPeriod}`,
    instrumentName: `DIA Lectura ${year} ${applicationPeriod}`,
    year,
    applicationPeriod,
    administeredAt: new Date(`${year}-06-01`),
  };
}

function makeService(rows: unknown[]): ComparableTrajectoryService {
  return new ComparableTrajectoryService(makeDb([GRADE, SUBJECT, rows]), makeAssembler());
}

const BASE_QUERY = {
  gradeId: 'grade-5',
  subjectId: 'subj-len',
  instrumentType: 'dia',
} as const;

describe('ComparableTrajectoryService — eje "trayectoria" (moments)', () => {
  it('recorre TODAS las aplicaciones de la familia en orden cronológico: año, y dentro del año el ciclo', async () => {
    const service = makeService([
      familyRow('a-4', 2026, 'intermedio'),
      familyRow('a-1', 2025, 'diagnostico'),
      familyRow('a-3', 2026, 'diagnostico'),
      familyRow('a-2', 2025, 'cierre'),
    ]);

    const res = await service.trajectory(makeUser(), { ...BASE_QUERY, axis: 'moments' });

    expect(res.series.map((p) => p.label)).toEqual([
      'Diagnóstico 2025',
      'Cierre 2025',
      'Diagnóstico 2026',
      'Monitoreo 2026',
    ]);
    expect(res.current?.label).toBe('Monitoreo 2026');
  });

  it('la clave de cada punto distingue año y momento, para que 2025 y 2026 no colisionen', async () => {
    const service = makeService([
      familyRow('a-1', 2025, 'diagnostico'),
      familyRow('a-2', 2026, 'diagnostico'),
    ]);

    const res = await service.trajectory(makeUser(), { ...BASE_QUERY, axis: 'moments' });

    expect(res.series.map((p) => p.key)).toEqual(['2025-diagnostico', '2026-diagnostico']);
    expect(res.series.map((p) => p.assessmentIds)).toEqual([['a-1'], ['a-2']]);
  });

  it('una historia que cruza años y momentos es comparable punto a punto, no "mixed"', async () => {
    const service = makeService([
      familyRow('a-1', 2025, 'diagnostico'),
      familyRow('a-2', 2025, 'cierre'),
      familyRow('a-3', 2026, 'diagnostico'),
    ]);

    const res = await service.trajectory(makeUser(), { ...BASE_QUERY, axis: 'moments' });

    expect(res.comparability.kind).toBe('instrument_history');
    expect(res.comparability.aggregatable).toBe(false);
  });

  it('con `year` la trayectoria se acota al ciclo de ese año', async () => {
    const service = makeService([
      familyRow('a-1', 2025, 'diagnostico'),
      familyRow('a-2', 2026, 'diagnostico'),
      familyRow('a-3', 2026, 'cierre'),
    ]);

    const res = await service.trajectory(makeUser(), {
      ...BASE_QUERY,
      axis: 'moments',
      year: 2026,
    });

    expect(res.series.map((p) => p.label)).toEqual(['Diagnóstico 2026', 'Cierre 2026']);
    expect(res.comparability.kind).toBe('period_series');
  });
});

describe('ComparableTrajectoryService — acotar a un curso', () => {
  const SELECTED_COURSE = [{ gradeId: 'grade-5', name: 'A' }];
  const COURSE_ACROSS_YEARS = [{ id: 'cg-2025-A' }, { id: 'cg-2026-A' }];
  const FAMILY = [familyRow('a-1', 2025, 'diagnostico'), familyRow('a-2', 2026, 'diagnostico')];

  it('sigue al mismo curso (nivel + letra) en todos los años, no sólo en el del `class_group` elegido', async () => {
    const spy: AssemblerSpy = { scopedClassGroupIds: [] };
    const db = makeDb([
      GRADE,
      SUBJECT,
      [{ name: 'A' }],
      SELECTED_COURSE,
      COURSE_ACROSS_YEARS,
      [],
      FAMILY,
    ]);
    const service = new ComparableTrajectoryService(db, makeAssembler(spy));

    const res = await service.trajectory(makeUser(), {
      ...BASE_QUERY,
      axis: 'moments',
      classGroupId: 'cg-2026-A',
    });

    expect(spy.scopedClassGroupIds[0]).toEqual(['cg-2025-A', 'cg-2026-A']);
    expect(res.series.map((p) => p.label)).toEqual(['Diagnóstico 2025', 'Diagnóstico 2026']);
  });

  it('a un profesor la expansión no le abre cursos fuera de su asignación', async () => {
    const spy: AssemblerSpy = { scopedClassGroupIds: [] };
    const db = makeDb([
      [{ classGroupId: 'cg-2026-A' }],
      GRADE,
      SUBJECT,
      [{ name: 'A' }],
      SELECTED_COURSE,
      COURSE_ACROSS_YEARS,
      [],
      FAMILY,
    ]);
    const service = new ComparableTrajectoryService(db, makeAssembler(spy));

    await service.trajectory(makeUser({ activeRole: 'teacher' }), {
      ...BASE_QUERY,
      axis: 'moments',
      classGroupId: 'cg-2026-A',
    });

    expect(spy.scopedClassGroupIds[0]).toEqual(['cg-2026-A']);
  });
});

describe('ComparableTrajectoryService — eje "generaciones" (years)', () => {
  it('fija el momento del ciclo y varía el año', async () => {
    const service = makeService([
      familyRow('a-1', 2026, 'diagnostico'),
      familyRow('a-2', 2025, 'diagnostico'),
      familyRow('a-3', 2025, 'cierre'),
    ]);

    const res = await service.trajectory(makeUser(), {
      ...BASE_QUERY,
      axis: 'years',
      applicationPeriod: 'diagnostico',
    });

    expect(res.series.map((p) => p.label)).toEqual(['2025', '2026']);
    expect(res.comparability.kind).toBe('instrument_family');
  });
});
