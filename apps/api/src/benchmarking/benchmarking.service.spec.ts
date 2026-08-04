import { ForbiddenException } from '@nestjs/common';
import type { Database } from '@soe/db';
import {
  BENCHMARK_K_MIN_SCHOOLS,
  BENCHMARK_N_MIN_STUDENTS,
  type BenchmarkComparisonQueryDto,
  type UserRole,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { BenchmarkingService } from './benchmarking.service';

// ──────────────────────────────────────────────────────────────────────────────
// Mock de Database. Cada `db.select()` consume el siguiente array de
// `selectResults` (en orden). Las cadenas Drizzle (from/innerJoin/leftJoin/where/
// orderBy/limit/offset) son fluidas y el resultado es thenable. `db.insert(...)`
// dentro de withOrgContext registra el log de auditoría.
// ──────────────────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  const role: UserRole = overrides.activeRole ?? overrides.role ?? 'school_admin';
  return {
    userId: 'user-1',
    orgId: 'org-you',
    email: 't@x.cl',
    name: 'Tester',
    isPlatformAdmin: role === 'platform_admin',
    roles: [role],
    activeRole: role,
    role,
    ...overrides,
  };
}

type DbMock = Database & {
  __inserts: Array<{ table: unknown; values: unknown }>;
  __transactionRan: boolean;
};

function makeDb(selectResults: unknown[][]): DbMock {
  let idx = 0;
  const inserts: Array<{ table: unknown; values: unknown }> = [];

  function buildSelect(rows: unknown[]): unknown {
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'offset']) {
      chain[m] = passthrough;
    }
    chain.then = (resolve: (rows: unknown[]) => unknown) =>
      Promise.resolve(rows).then(resolve);
    return chain;
  }

  const db = {
    select: () => {
      const rows = selectResults[idx] ?? [];
      idx++;
      return buildSelect(rows);
    },
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return Promise.resolve([]);
      },
    }),
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      db.__transactionRan = true;
      return fn(db);
    },
    __inserts: inserts,
    __transactionRan: false,
  } as unknown as DbMock;

  return db;
}

function makeService(db: Database): BenchmarkingService {
  return new (BenchmarkingService as new (db: Database) => BenchmarkingService)(db);
}

const aggRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'agg-1',
  orgId: 'org-x',
  instrumentId: 'inst-1',
  gradeId: null,
  subjectId: null,
  dependence: null,
  region: null,
  commune: null,
  networkOrgId: null,
  studentCount: 30,
  avgAchievement: '60.00',
  bandDistribution: { insufficient: 5, elementary: 10, adequate: 10, advanced: 5 },
  perSkill: [],
  optOutGlobalPool: false,
  refreshedAt: new Date('2026-06-01T00:00:00Z'),
  createdAt: new Date('2026-06-01T00:00:00Z'),
  updatedAt: new Date('2026-06-01T00:00:00Z'),
  ...overrides,
});

const baseQuery: BenchmarkComparisonQueryDto = {
  instrumentId: '11111111-1111-1111-1111-111111111111',
  mode: 'global',
};

// ──────────────────────────────────────────────────────────────────────────────

describe('BenchmarkingService.compare (global)', () => {
  it('lanza ForbiddenException si el usuario no tiene org activa', async () => {
    const svc = makeService(makeDb([]));
    await expect(svc.compare(makeUser({ orgId: null }), baseQuery)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('calcula percentil de tu colegio, mediana y cuartiles de la cohorte', async () => {
    // selects en orden:
    // 1 resolveInstrumentName, 2 findYourRow, 3 fetchCohortRows
    const your = aggRow({ orgId: 'org-you', avgAchievement: '70.00', studentCount: 25 });
    const cohort = [
      aggRow({ orgId: 'a', avgAchievement: '50.00', studentCount: 25 }),
      aggRow({ orgId: 'b', avgAchievement: '60.00', studentCount: 25 }),
      aggRow({ orgId: 'org-you', avgAchievement: '70.00', studentCount: 25 }),
      aggRow({ orgId: 'c', avgAchievement: '80.00', studentCount: 25 }),
    ];
    const db = makeDb([[{ name: 'Prueba X' }], [your], cohort]);
    const svc = makeService(db);

    const res = await svc.compare(makeUser(), baseQuery);

    expect(res.suppressed).toBe(false);
    expect(res.cohort).not.toBeNull();
    expect(res.cohort!.schoolCount).toBe(4);
    expect(res.cohort!.studentCount).toBe(100);
    expect(res.cohort!.median).toBe(65); // mediana de [50,60,70,80]
    expect(res.cohort!.p25).toBe(57.5);
    expect(res.cohort!.p75).toBe(72.5);
    // 70 es el 3º de 4: below=2, equal=1 → (2 + 0.5)/4 * 100 = 62.5
    expect(res.yourSchool!.percentile).toBe(62.5);
    expect(res.yourSchool!.avgAchievement).toBe(70);
    // auditoría escrita dentro de withOrgContext
    expect(db.__transactionRan).toBe(true);
    expect(db.__inserts).toHaveLength(1);
  });

  it('suprime la cohorte por k-anonimato cuando hay < k colegios', async () => {
    const your = aggRow({ orgId: 'org-you' });
    // 2 colegios (< BENCHMARK_K_MIN_SCHOOLS=3) aunque tengan muchos alumnos
    const cohort = [
      aggRow({ orgId: 'a', studentCount: 100 }),
      aggRow({ orgId: 'b', studentCount: 100 }),
    ];
    expect(cohort.length).toBeLessThan(BENCHMARK_K_MIN_SCHOOLS);
    const db = makeDb([[{ name: 'Prueba X' }], [your], cohort]);
    const svc = makeService(db);

    const res = await svc.compare(makeUser(), baseQuery);

    expect(res.suppressed).toBe(true);
    expect(res.cohort).toBeNull();
    expect(res.yourSchool).toBeNull();
    expect(res.networkSchools).toBeNull();
    expect(res.suppressionReason).toContain(String(BENCHMARK_K_MIN_SCHOOLS));
    // el access log registra suppressed=true
    expect((db.__inserts[0].values as { suppressed: boolean }).suppressed).toBe(true);
  });

  it('suprime la cohorte por k-anonimato cuando hay < n alumnos', async () => {
    const your = aggRow({ orgId: 'org-you' });
    // 3 colegios pero pocos alumnos en total (< BENCHMARK_N_MIN_STUDENTS=20)
    const cohort = [
      aggRow({ orgId: 'a', studentCount: 5 }),
      aggRow({ orgId: 'b', studentCount: 5 }),
      aggRow({ orgId: 'c', studentCount: 5 }),
    ];
    const total = cohort.reduce((s, r) => s + r.studentCount, 0);
    expect(total).toBeLessThan(BENCHMARK_N_MIN_STUDENTS);
    const db = makeDb([[{ name: 'Prueba X' }], [your], cohort]);
    const svc = makeService(db);

    const res = await svc.compare(makeUser(), baseQuery);

    expect(res.suppressed).toBe(true);
    expect(res.cohort).toBeNull();
  });

  it('reporta siempre los thresholds desde @soe/types', async () => {
    const db = makeDb([[{ name: 'P' }], [], []]);
    const svc = makeService(db);
    const res = await svc.compare(makeUser(), baseQuery);
    expect(res.thresholds.kMinSchools).toBe(BENCHMARK_K_MIN_SCHOOLS);
    expect(res.thresholds.nMinStudents).toBe(BENCHMARK_N_MIN_STUDENTS);
  });
});

describe('BenchmarkingService.compare (network)', () => {
  const networkQuery: BenchmarkComparisonQueryDto = { ...baseQuery, mode: 'network' };

  it('devuelve red vacía + disclaimer cuando el caller no tiene red', async () => {
    // selects: 1 resolveInstrumentName, 2 findYourRow, 3 deriveNetworkOrgId (org sin parent)
    const your = aggRow({ orgId: 'org-you' });
    const db = makeDb([[{ name: 'Prueba X' }], [your], [{ parentId: null }]]);
    const svc = makeService(db);

    const res = await svc.compare(makeUser(), networkQuery);

    expect(res.mode).toBe('network');
    expect(res.networkSchools).toEqual([]);
    expect(res.suppressionReason).toContain('red');
  });

  it('devuelve filas identificadas de la red (parent foundation), sin supresión por k', async () => {
    const your = aggRow({ orgId: 'org-you', avgAchievement: '70.00', studentCount: 4 });
    // selects:
    // 1 resolveInstrumentName
    // 2 findYourRow
    // 3 deriveNetworkOrgId: org tiene parent
    // 4 deriveNetworkOrgId: parent es foundation
    // 5 fetchCohortRows (network)
    // 6 resolveOrgNames
    const networkRows = [
      aggRow({ orgId: 'org-you', networkOrgId: 'found-1', avgAchievement: '70.00', studentCount: 4 }),
      aggRow({ orgId: 'sib-1', networkOrgId: 'found-1', avgAchievement: '40.00', studentCount: 3 }),
    ];
    const db = makeDb([
      [{ name: 'Prueba X' }],
      [your],
      [{ parentId: 'found-1' }],
      [{ id: 'found-1', type: 'foundation' }],
      networkRows,
      [
        { id: 'org-you', name: 'Mi Colegio' },
        { id: 'sib-1', name: 'Colegio Hermano' },
      ],
    ]);
    const svc = makeService(db);

    const res = await svc.compare(makeUser(), networkQuery);

    expect(res.mode).toBe('network');
    expect(res.suppressed).toBe(false); // red NUNCA se suprime por k aunque sean 2 colegios / 7 alumnos
    expect(res.networkSchools).toHaveLength(2);
    const you = res.networkSchools!.find((s) => s.orgId === 'org-you');
    expect(you?.isYou).toBe(true);
    expect(you?.orgName).toBe('Mi Colegio');
    const sib = res.networkSchools!.find((s) => s.orgId === 'sib-1');
    expect(sib?.isYou).toBe(false);
    expect(sib?.orgName).toBe('Colegio Hermano');
  });
});

describe('BenchmarkingService.listInstruments', () => {
  it('lista instrumentos donde la org tiene datos en el read-model', async () => {
    const db = makeDb([
      [
        {
          instrumentId: 'inst-1',
          instrumentName: 'Prueba X',
          gradeId: 'g1',
          gradeName: '3° básico',
          subjectId: 's1',
          subjectName: 'Lectura',
          yourStudentCount: 30,
        },
      ],
    ]);
    const svc = makeService(db);

    const res = await svc.listInstruments(makeUser());

    expect(res.data).toHaveLength(1);
    expect(res.data[0].instrumentName).toBe('Prueba X');
    expect(res.data[0].yourStudentCount).toBe(30);
  });
});

describe('BenchmarkingService.listAudit', () => {
  it('lista los accesos de la propia org (paginado) dentro de withOrgContext', async () => {
    const db = makeDb([
      [{ total: 1 }],
      [
        {
          id: 'log-1',
          orgId: 'org-you',
          userId: 'user-1',
          mode: 'global',
          instrumentId: 'inst-1',
          filters: { region: 'RM' },
          cohortSchoolCount: 4,
          cohortStudentCount: 100,
          suppressed: false,
          createdAt: new Date('2026-06-10T00:00:00Z'),
        },
      ],
    ]);
    const svc = makeService(db);

    const res = await svc.listAudit(makeUser(), { page: 1, limit: 20 });

    expect(db.__transactionRan).toBe(true);
    expect(res.total).toBe(1);
    expect(res.data).toHaveLength(1);
    expect(res.data[0].mode).toBe('global');
    expect(res.data[0].createdAt).toBe('2026-06-10T00:00:00.000Z');
  });
});
