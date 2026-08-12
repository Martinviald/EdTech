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

const GRADE = [{ name: '5º básico', order: 5 }];
const SUBJECT = [{ name: 'Lenguaje' }];

const GRADE_CATALOG = [
  { order: 6, name: '6º básico' },
  { order: 7, name: '7º básico' },
];

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

function makeService(rows: unknown[], gradeCatalog: unknown[] = GRADE_CATALOG) {
  return new ComparableTrajectoryService(
    makeDb([GRADE, SUBJECT, rows, gradeCatalog]),
    makeAssembler(),
  );
}

const BASE_QUERY = {
  gradeId: 'grade-5',
  subjectId: 'subj-len',
  instrumentType: 'dia',
} as const;

describe('ComparableTrajectoryService — matriz año × momento', () => {
  it('devuelve una serie por año, de la más reciente a la más antigua, con el ciclo en orden', async () => {
    const service = makeService([
      familyRow('a-4', 2026, 'intermedio'),
      familyRow('a-1', 2025, 'diagnostico'),
      familyRow('a-3', 2026, 'diagnostico'),
      familyRow('a-2', 2025, 'cierre'),
    ]);

    const res = await service.trajectory(makeUser(), BASE_QUERY);

    expect(res.series.map((s) => s.year)).toEqual([2026, 2025]);
    expect(res.series[0]!.points.map((p) => p.label)).toEqual(['Diagnóstico', 'Monitoreo']);
    expect(res.series[1]!.points.map((p) => p.label)).toEqual(['Diagnóstico', 'Cierre']);
  });

  it('la clave del punto es el momento del ciclo; el año vive en la serie', async () => {
    const service = makeService([
      familyRow('a-1', 2025, 'diagnostico'),
      familyRow('a-2', 2026, 'diagnostico'),
    ]);

    const res = await service.trajectory(makeUser(), BASE_QUERY);

    expect(res.series.map((s) => s.points.map((p) => p.key))).toEqual([
      ['diagnostico'],
      ['diagnostico'],
    ]);
    expect(res.series.map((s) => s.points.map((p) => p.year))).toEqual([[2026], [2025]]);
    expect(res.series.map((s) => s.points.map((p) => p.assessmentIds))).toEqual([
      [['a-2']],
      [['a-1']],
    ]);
  });

  it('un año al que le falta un momento deja el hueco: no corre los puntos ni rompe el eje', async () => {
    const service = makeService([
      familyRow('a-1', 2025, 'diagnostico'),
      familyRow('a-2', 2025, 'intermedio'),
      familyRow('a-3', 2025, 'cierre'),
      familyRow('a-4', 2026, 'diagnostico'),
      familyRow('a-5', 2026, 'cierre'),
    ]);

    const res = await service.trajectory(makeUser(), BASE_QUERY);

    expect(res.periods.map((p) => p.key)).toEqual(['diagnostico', 'intermedio', 'cierre']);
    expect(res.series[0]!.points.map((p) => p.key)).toEqual(['diagnostico', 'cierre']);
    expect(res.series[1]!.points.map((p) => p.key)).toEqual([
      'diagnostico',
      'intermedio',
      'cierre',
    ]);
  });

  it('`periods` es la unión de los momentos de TODA la data, en el orden del ciclo', async () => {
    const service = makeService([
      familyRow('a-1', 2024, 'cierre'),
      familyRow('a-2', 2026, 'diagnostico'),
    ]);

    const res = await service.trajectory(makeUser(), BASE_QUERY);

    expect(res.periods).toEqual([
      { key: 'diagnostico', label: 'Diagnóstico' },
      { key: 'cierre', label: 'Cierre' },
    ]);
  });

  it('un instrumento sin momento declarado aterriza en "Sin momento", al final del eje', async () => {
    const service = makeService([
      { ...familyRow('a-1', 2026, 'diagnostico'), applicationPeriod: null },
      familyRow('a-2', 2026, 'diagnostico'),
    ]);

    const res = await service.trajectory(makeUser(), BASE_QUERY);

    expect(res.periods.map((p) => p.key)).toEqual(['diagnostico', 'none']);
    expect(res.series[0]!.points.map((p) => p.label)).toEqual(['Diagnóstico', 'Sin momento']);
  });

  it('`current` es el último momento con datos del año más reciente', async () => {
    const service = makeService([
      familyRow('a-1', 2025, 'cierre'),
      familyRow('a-2', 2026, 'diagnostico'),
      familyRow('a-3', 2026, 'intermedio'),
    ]);

    const res = await service.trajectory(makeUser(), BASE_QUERY);

    expect(res.current?.year).toBe(2026);
    expect(res.current?.label).toBe('Monitoreo');
  });

  it('con `year` la matriz queda en una sola serie: el ciclo de ese año', async () => {
    const service = makeService([
      familyRow('a-1', 2025, 'diagnostico'),
      familyRow('a-2', 2026, 'diagnostico'),
      familyRow('a-3', 2026, 'cierre'),
    ]);

    const res = await service.trajectory(makeUser(), { ...BASE_QUERY, year: 2026 });

    expect(res.series.map((s) => s.year)).toEqual([2026]);
    expect(res.series[0]!.points.map((p) => p.label)).toEqual(['Diagnóstico', 'Cierre']);
    expect(res.comparability.kind).toBe('period_series');
  });

  it('una historia que cruza años y momentos es comparable punto a punto, no "mixed"', async () => {
    const service = makeService([
      familyRow('a-1', 2025, 'diagnostico'),
      familyRow('a-2', 2025, 'cierre'),
      familyRow('a-3', 2026, 'diagnostico'),
    ]);

    const res = await service.trajectory(makeUser(), BASE_QUERY);

    expect(res.comparability.kind).toBe('instrument_history');
    expect(res.comparability.aggregatable).toBe(false);
  });
});

describe('ComparableTrajectoryService — etiqueta de la generación', () => {
  it('el año de referencia va sin proyección; los anteriores dicen dónde están hoy', async () => {
    const service = makeService([
      familyRow('a-1', 2024, 'diagnostico'),
      familyRow('a-2', 2025, 'diagnostico'),
      familyRow('a-3', 2026, 'diagnostico'),
    ]);

    const res = await service.trajectory(makeUser(), BASE_QUERY);

    expect(res.series.map((s) => s.label)).toEqual([
      '2026',
      '2025 · hoy 6º básico',
      '2024 · hoy 7º básico',
    ]);
    expect(res.series.map((s) => s.currentGradeName)).toEqual([null, '6º básico', '7º básico']);
  });

  it('si la generación se pasó del último nivel, la etiqueta queda en el año a secas', async () => {
    const service = makeService(
      [familyRow('a-1', 2024, 'diagnostico'), familyRow('a-2', 2026, 'diagnostico')],
      [],
    );

    const res = await service.trajectory(makeUser(), BASE_QUERY);

    expect(res.series.map((s) => s.label)).toEqual(['2026', '2024']);
    expect(res.series.map((s) => s.currentGradeName)).toEqual([null, null]);
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
      GRADE_CATALOG,
    ]);
    const service = new ComparableTrajectoryService(db, makeAssembler(spy));

    const res = await service.trajectory(makeUser(), {
      ...BASE_QUERY,
      classGroupId: 'cg-2026-A',
    });

    expect(spy.scopedClassGroupIds[0]).toEqual(['cg-2025-A', 'cg-2026-A']);
    expect(res.series.map((s) => s.year)).toEqual([2026, 2025]);
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
      GRADE_CATALOG,
    ]);
    const service = new ComparableTrajectoryService(db, makeAssembler(spy));

    await service.trajectory(makeUser({ activeRole: 'teacher' }), {
      ...BASE_QUERY,
      classGroupId: 'cg-2026-A',
    });

    expect(spy.scopedClassGroupIds[0]).toEqual(['cg-2026-A']);
  });
});

describe('ComparableTrajectoryService — sin datos', () => {
  it('la respuesta vacía trae la forma nueva: sin series y sin eje', async () => {
    const service = makeService([]);

    const res = await service.trajectory(makeUser(), BASE_QUERY);

    expect(res.series).toEqual([]);
    expect(res.periods).toEqual([]);
    expect(res.current).toBeNull();
    expect(res.gradeName).toBe('5º básico');
  });
});
