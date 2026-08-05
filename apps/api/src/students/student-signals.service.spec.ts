import type { Database } from '@soe/db';
import type { UserRole } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { StudentSignalsService } from './student-signals.service';

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

function makeService(db: Database): StudentSignalsService {
  return new (StudentSignalsService as new (db: Database) => StudentSignalsService)(db);
}

const ROSTER = [
  {
    studentId: 'stu-1',
    firstName: 'Ana',
    lastName: 'Pérez',
    rut: '11.111.111-1',
    classGroupName: 'A',
    gradeName: '5º básico',
  },
];

function resultRow(overrides: Record<string, unknown> = {}) {
  return {
    studentId: 'stu-1',
    assessmentId: 'a-1',
    instrumentId: 'inst-1',
    instrumentName: 'DIA Lectura 5º',
    instrumentType: 'dia',
    subjectId: 'subj-len',
    subjectName: 'Lenguaje',
    gradeId: 'grade-5',
    year: 2026,
    applicationPeriod: 'diagnostico',
    administeredAt: new Date('2026-03-01'),
    achievement: '70.00',
    bandKey: 'II',
    bandLabel: 'Nivel II',
    bandOrder: 1,
    bandColor: null,
    priorBandKey: null,
    priorBandLabel: null,
    priorBandOrder: null,
    priorBandColor: null,
    ...overrides,
  };
}

function bandRow(key: string, order: number) {
  return {
    id: `inst-1-${key}`,
    orgId: null,
    key,
    label: `Nivel ${key}`,
    order,
    minThreshold: '0.0000',
    maxThreshold: '1.0000',
    color: null,
    instrumentId: 'inst-1',
  };
}

const DIA_BANDS = [bandRow('I', 0), bandRow('II', 1), bandRow('III', 2)];

describe('StudentSignalsService', () => {
  it('marca el retroceso de nivel que el informe de cierre ya trae persistido', async () => {
    const db = makeDb([
      ROSTER,
      [
        resultRow({
          bandKey: 'I',
          bandLabel: 'Nivel I',
          bandOrder: 0,
          priorBandKey: 'III',
          priorBandLabel: 'Nivel III',
          priorBandOrder: 2,
        }),
      ],
      DIA_BANDS,
    ]);

    const result = await makeService(db).getSignals(makeUser(), {});

    expect(result.data[0]?.signals).toEqual(expect.arrayContaining(['band_drop', 'lowest_band']));
    expect(result.counts.band_drop).toBe(1);
  });

  it('distingue un mal resultado de un bajo persistente', async () => {
    const unaVez = makeDb([
      ROSTER,
      [resultRow({ bandKey: 'I', bandLabel: 'Nivel I', bandOrder: 0 })],
      DIA_BANDS,
    ]);
    const soloUna = await makeService(unaVez).getSignals(makeUser(), {});
    expect(soloUna.data[0]?.signals).toContain('lowest_band');
    expect(soloUna.data[0]?.signals).not.toContain('persistent_low');

    const dosVeces = makeDb([
      ROSTER,
      [
        resultRow({ assessmentId: 'a-1', bandKey: 'I', bandLabel: 'Nivel I', bandOrder: 0 }),
        resultRow({ assessmentId: 'a-2', bandKey: 'I', bandLabel: 'Nivel I', bandOrder: 0 }),
      ],
      DIA_BANDS,
    ]);
    const persistente = await makeService(dosVeces).getSignals(makeUser(), {});
    expect(persistente.data[0]?.signals).toContain('persistent_low');
  });

  it('sólo marca la caída de logro entre resultados comparables entre sí', async () => {
    const comparables = makeDb([
      ROSTER,
      [
        resultRow({ assessmentId: 'a-dg', achievement: '80.00' }),
        resultRow({
          assessmentId: 'a-cierre',
          instrumentId: 'inst-2',
          applicationPeriod: 'cierre',
          achievement: '60.00',
        }),
      ],
      DIA_BANDS,
    ]);
    const conCaida = await makeService(comparables).getSignals(makeUser(), {});
    expect(conCaida.data[0]?.signals).toContain('achievement_drop');
    expect(conCaida.data[0]?.dropPp).toBe(-20);

    const noComparables = makeDb([
      ROSTER,
      [
        resultRow({ assessmentId: 'a-len', achievement: '80.00' }),
        resultRow({
          assessmentId: 'a-mate',
          instrumentId: 'inst-mate',
          subjectId: 'subj-mate',
          achievement: '60.00',
        }),
      ],
      DIA_BANDS,
    ]);
    const sinCaida = await makeService(noComparables).getSignals(makeUser(), {});
    expect(sinCaida.data[0]?.signals).not.toContain('achievement_drop');
    expect(sinCaida.data[0]?.dropPp).toBeNull();
  });

  it('filtra por señal y conserva los conteos de todo el alcance', async () => {
    const db = makeDb([
      [
        ...ROSTER,
        {
          studentId: 'stu-2',
          firstName: 'Beto',
          lastName: 'Soto',
          rut: '22.222.222-2',
          classGroupName: 'A',
          gradeName: '5º básico',
        },
      ],
      [resultRow({ bandKey: 'I', bandLabel: 'Nivel I', bandOrder: 0 })],
      DIA_BANDS,
    ]);

    const result = await makeService(db).getSignals(makeUser(), { signal: 'lowest_band' });

    expect(result.data.map((r) => r.studentId)).toEqual(['stu-1']);
    expect(result.total).toBe(1);
    expect(result.counts.lowest_band).toBe(1);
  });

  it('devuelve vacío para un profesor sin cursos asignados', async () => {
    const db = makeDb([[]]);
    const result = await makeService(db).getSignals(makeUser({ activeRole: 'teacher' }), {});
    expect(result).toEqual({
      data: [],
      total: 0,
      counts: { band_drop: 0, lowest_band: 0, persistent_low: 0, achievement_drop: 0 },
    });
  });
});
