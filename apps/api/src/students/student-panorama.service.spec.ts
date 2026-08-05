import type { Database } from '@soe/db';
import type { UserRole } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { StudentPanoramaService } from './student-panorama.service';

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

function makeService(db: Database): StudentPanoramaService {
  return new (StudentPanoramaService as new (db: Database) => StudentPanoramaService)(db);
}

const STUDENT = { id: 'stu-1', firstName: 'Ana', lastName: 'Pérez', rut: '11.111.111-1' };
const ENROLLMENT = { classGroupId: 'cg-1', classGroupName: 'A', gradeName: '5º básico' };

function assessmentRow(overrides: Record<string, unknown> = {}) {
  return {
    assessmentId: 'a-1',
    assessmentName: 'DIA Lectura',
    instrumentId: 'inst-1',
    instrumentName: 'DIA Lectura 5º',
    subjectName: 'Lenguaje',
    administeredAt: new Date('2026-03-01'),
    dataGranularity: 'item_level',
    achievement: '70.00',
    grade: '5.50',
    performanceLevel: 'adequate',
    bandKey: 'II',
    bandLabel: 'Nivel II',
    bandOrder: 1,
    bandColor: '#f59e0b',
    priorBandKey: null,
    priorBandLabel: null,
    priorBandOrder: null,
    priorBandColor: null,
    ...overrides,
  };
}

function bandRow(instrumentId: string, key: string, label: string, order: number) {
  return {
    id: `${instrumentId}-${key}`,
    orgId: null,
    key,
    label,
    order,
    minThreshold: '0.0000',
    maxThreshold: '1.0000',
    color: null,
    instrumentId,
  };
}

function skillRow(overrides: Record<string, unknown> = {}) {
  return {
    nodeId: 'node-1',
    nodeName: 'Localizar información',
    nodeType: 'skill',
    nodeCode: null,
    parentNodeId: null,
    nodeOrder: 0,
    correctCount: 5,
    totalCount: 10,
    assessmentsCount: 1,
    ...overrides,
  };
}

const DIA_BANDS = (instrumentId: string) => [
  bandRow(instrumentId, 'I', 'Nivel I', 0),
  bandRow(instrumentId, 'II', 'Nivel II', 1),
  bandRow(instrumentId, 'III', 'Nivel III', 2),
];

describe('StudentPanoramaService — resultados de informes agregados', () => {
  it('cuenta las filas sin porcentaje en la distribución y expone el denominador real del promedio', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [
        assessmentRow({ assessmentId: 'a-1', achievement: '70.00', bandKey: 'II', bandOrder: 1 }),
        assessmentRow({
          assessmentId: 'a-2',
          instrumentId: 'inst-2',
          achievement: null,
          grade: null,
          performanceLevel: null,
          dataGranularity: 'aggregate_only',
          bandKey: 'I',
          bandLabel: 'Nivel I',
          bandOrder: 0,
        }),
      ],
      [],
      [...DIA_BANDS('inst-1'), ...DIA_BANDS('inst-2')],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    expect(result.summary.assessmentsCount).toBe(2);
    expect(result.summary.assessmentsWithAchievement).toBe(1);
    expect(result.summary.averageAchievement).toBe(70);

    expect(result.distribution.kind).toBe('band');
    if (result.distribution.kind !== 'band') throw new Error('esperaba distribución por banda');
    const counted = result.distribution.buckets.reduce((acc, b) => acc + b.count, 0);
    expect(counted).toBe(2);
    expect(result.distribution.buckets.find((b) => b.key === 'I')?.count).toBe(1);
    expect(result.distribution.buckets.find((b) => b.key === 'II')?.count).toBe(1);
  });

  it('emite la banda vacía del vocabulario aunque el alumno no la alcance', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [assessmentRow()],
      [],
      DIA_BANDS('inst-1'),
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    if (result.distribution.kind !== 'band') throw new Error('esperaba distribución por banda');
    expect(result.distribution.buckets.map((b) => b.key)).toEqual(['I', 'II', 'III']);
    expect(result.distribution.buckets.find((b) => b.key === 'III')?.count).toBe(0);
  });

  it('no clasifica cuando los resultados vienen de escalas de logro distintas', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [
        assessmentRow(),
        assessmentRow({
          assessmentId: 'a-2',
          instrumentId: 'inst-2',
          bandKey: 'A2',
          bandLabel: 'A2 — Elementary',
          bandOrder: 1,
        }),
      ],
      [],
      [
        ...DIA_BANDS('inst-1'),
        bandRow('inst-2', 'A1', 'A1 — Beginner', 0),
        bandRow('inst-2', 'A2', 'A2 — Elementary', 1),
      ],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    expect(result.distribution).toEqual({ kind: 'mixed', scaleCount: 2 });
  });

  it('trata como escalas distintas una fila con banda y otra clasificada sólo con el enum legacy', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [
        assessmentRow(),
        assessmentRow({
          assessmentId: 'a-2',
          instrumentId: 'inst-2',
          bandKey: null,
          bandLabel: null,
          bandOrder: null,
          bandColor: null,
          performanceLevel: 'elementary',
        }),
      ],
      [],
      DIA_BANDS('inst-1'),
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    expect(result.distribution).toEqual({ kind: 'mixed', scaleCount: 2 });
  });

  it('declara vacío cuando ningún resultado trae nivel ni banda', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [
        assessmentRow({
          performanceLevel: null,
          bandKey: null,
          bandLabel: null,
          bandOrder: null,
          bandColor: null,
        }),
      ],
      [],
      DIA_BANDS('inst-1'),
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    expect(result.distribution).toEqual({ kind: 'empty' });
    expect(result.summary.assessmentsWithAchievement).toBe(1);
  });

  it('expone el nivel previo del informe de cierre como movimiento del alumno', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [
        assessmentRow({
          priorBandKey: 'I',
          priorBandLabel: 'Nivel I',
          priorBandOrder: 0,
          priorBandColor: '#ef4444',
        }),
      ],
      [],
      DIA_BANDS('inst-1'),
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    expect(result.byAssessment[0]?.priorPerformanceBand).toEqual({
      key: 'I',
      label: 'Nivel I',
      order: 0,
      color: '#ef4444',
    });
    expect(result.byAssessment[0]?.dataGranularity).toBe('item_level');
  });
});

describe('StudentPanoramaService — logro por habilidad', () => {
  it('deriva el logro del nodo desde los conteos de ítems, no de un promedio de porcentajes', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [],
      [skillRow({ nodeCode: 'LOC', correctCount: 6, totalCount: 12, assessmentsCount: 2 })],
      [],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    expect(result.bySkill[0]).toMatchObject({
      nodeId: 'node-1',
      correctCount: 6,
      totalCount: 12,
      achievement: 50,
      assessmentsCount: 2,
    });
  });

  it('anida los OA bajo su habilidad y ésta bajo su eje, en orden curricular', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [],
      [
        skillRow({
          nodeId: 'oa-2',
          nodeName: 'OA 2',
          nodeType: 'learning_objective',
          parentNodeId: 'hab',
          nodeOrder: 1,
        }),
        skillRow({
          nodeId: 'eje',
          nodeName: 'Lectura',
          nodeType: 'axis',
          parentNodeId: null,
          nodeOrder: 0,
        }),
        skillRow({
          nodeId: 'oa-1',
          nodeName: 'OA 1',
          nodeType: 'learning_objective',
          parentNodeId: 'hab',
          nodeOrder: 0,
        }),
        skillRow({
          nodeId: 'hab',
          nodeName: 'Localizar',
          nodeType: 'skill',
          parentNodeId: 'eje',
          nodeOrder: 0,
        }),
      ],
      [],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    expect(result.bySkillTree.map((n) => n.nodeId)).toEqual(['eje']);
    const eje = result.bySkillTree[0]!;
    expect(eje.children.map((n) => n.nodeId)).toEqual(['hab']);
    expect(eje.children[0]!.children.map((n) => n.nodeId)).toEqual(['oa-1', 'oa-2']);
    expect(result.bySkill).toHaveLength(4);
  });

  it('sube a raíz un nodo cuyo padre no está entre los evaluados', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [],
      [
        skillRow({ nodeId: 'huerfano', nodeName: 'OA suelto', parentNodeId: 'eje-no-evaluado' }),
        skillRow({ nodeId: 'raiz', nodeName: 'Eje', parentNodeId: null }),
      ],
      [],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    expect(result.bySkillTree.map((n) => n.nodeId).sort()).toEqual(['huerfano', 'raiz']);
  });

  it('ordena las habilidades por logro ascendente y deja al final las sin medir', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [],
      [
        skillRow({ nodeId: 'n-alto', nodeName: 'Alto', correctCount: 9, totalCount: 10 }),
        skillRow({ nodeId: 'n-sin', nodeName: 'Sin medir', correctCount: 0, totalCount: 0 }),
        skillRow({ nodeId: 'n-bajo', nodeName: 'Bajo', correctCount: 2, totalCount: 10 }),
      ],
      [],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    expect(result.bySkill.map((s) => s.nodeId)).toEqual(['n-bajo', 'n-alto', 'n-sin']);
    expect(result.bySkill[2]?.achievement).toBeNull();
  });
});
