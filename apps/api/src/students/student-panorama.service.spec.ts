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
    instrumentType: 'dia',
    subjectId: 'subj-len',
    subjectName: 'Lenguaje',
    gradeId: 'grade-5',
    year: 2026,
    applicationPeriod: 'diagnostico',
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

function familyRow(instrumentId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: instrumentId,
    type: 'dia',
    subjectId: 'subj-len',
    gradeId: 'grade-5',
    applicationPeriod: 'diagnostico',
    year: 2026,
    ...overrides,
  };
}

function bandRow(
  instrumentId: string,
  key: string,
  label: string,
  order: number,
  thresholds: { min: string; max: string } = { min: '0.0000', max: '1.0000' },
) {
  return {
    id: `${instrumentId}-${key}`,
    orgId: null,
    key,
    label,
    order,
    minThreshold: thresholds.min,
    maxThreshold: thresholds.max,
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
  bandRow(instrumentId, 'I', 'Nivel I', 0, { min: '0.0000', max: '0.4000' }),
  bandRow(instrumentId, 'II', 'Nivel II', 1, { min: '0.4000', max: '0.7000' }),
  bandRow(instrumentId, 'III', 'Nivel III', 2, { min: '0.7000', max: '1.0000' }),
];

describe('StudentPanoramaService — bandas efectivas del instrumento', () => {
  it('clasifica una fila legacy (sin performanceBandId) con las bandas resueltas del instrumento', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [
        assessmentRow({
          achievement: '75.00',
          performanceLevel: 'adequate',
          bandKey: null,
          bandLabel: null,
          bandOrder: null,
          bandColor: null,
        }),
      ],
      [familyRow('inst-1')],
      DIA_BANDS('inst-1'),
      [],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    const only = result.byAssessment[0]!;
    expect(only.performanceBand).toEqual({ key: 'III', label: 'Nivel III', order: 2, color: null });
    expect(only.performanceLevel).toBe('advanced');
  });

  it('conserva el nivel legacy almacenado cuando no hay bandas resueltas (source none)', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [
        assessmentRow({
          achievement: '75.00',
          performanceLevel: 'elementary',
          bandKey: null,
          bandLabel: null,
          bandOrder: null,
          bandColor: null,
        }),
      ],
      [familyRow('inst-1')],
      [],
      [],
      [],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    const only = result.byAssessment[0]!;
    expect(only.performanceBand).toBeNull();
    expect(only.performanceLevel).toBe('elementary');
  });

  it('respeta la banda ya persistida (performanceBandId no nulo) sin reclasificar', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [assessmentRow()],
      [familyRow('inst-1')],
      DIA_BANDS('inst-1'),
      [],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    const only = result.byAssessment[0]!;
    expect(only.performanceBand).toEqual({
      key: 'II',
      label: 'Nivel II',
      order: 1,
      color: '#f59e0b',
    });
    expect(only.performanceLevel).toBe('adequate');
  });

  it('deja intacta una fila legacy sin porcentaje (achievement null)', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [
        assessmentRow({
          achievement: null,
          grade: null,
          performanceLevel: 'insufficient',
          dataGranularity: 'aggregate_only',
          bandKey: null,
          bandLabel: null,
          bandOrder: null,
          bandColor: null,
        }),
      ],
      [familyRow('inst-1')],
      DIA_BANDS('inst-1'),
      [],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    const only = result.byAssessment[0]!;
    expect(only.performanceBand).toBeNull();
    expect(only.performanceLevel).toBe('insufficient');
  });

  it('el estado (latest) por asignatura refleja la banda resuelta', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [
        assessmentRow({
          achievement: '30.00',
          performanceLevel: 'adequate',
          bandKey: null,
          bandLabel: null,
          bandOrder: null,
          bandColor: null,
        }),
      ],
      [familyRow('inst-1')],
      DIA_BANDS('inst-1'),
      [],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    expect(result.bySubject).toHaveLength(1);
    const lenguaje = result.bySubject[0]!;
    expect(lenguaje.latest?.performanceBand?.key).toBe('I');
    expect(lenguaje.latest?.performanceLevel).toBe('insufficient');
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
      [familyRow('inst-1')],
      DIA_BANDS('inst-1'),
      [],
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

  it('no expone un campo de distribución agregada en la respuesta', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [assessmentRow()],
      [familyRow('inst-1')],
      DIA_BANDS('inst-1'),
      [],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    expect('distribution' in result).toBe(false);
  });
});

describe('StudentPanoramaService — resumen y denominador del promedio', () => {
  it('cuenta las evaluaciones sin porcentaje y expone el denominador real del promedio', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [
        assessmentRow({ assessmentId: 'a-1', achievement: '70.00' }),
        assessmentRow({
          assessmentId: 'a-2',
          achievement: null,
          grade: null,
          performanceLevel: 'insufficient',
          dataGranularity: 'aggregate_only',
          bandKey: 'I',
          bandLabel: 'Nivel I',
          bandOrder: 0,
        }),
      ],
      [familyRow('inst-1')],
      DIA_BANDS('inst-1'),
      [],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    expect(result.summary.assessmentsCount).toBe(2);
    expect(result.summary.assessmentsWithAchievement).toBe(1);
    expect(result.summary.averageAchievement).toBe(70);
  });
});

describe('StudentPanoramaService — alcance comparable', () => {
  const DOS_ANOS = [
    assessmentRow({ assessmentId: 'a-2025', instrumentId: 'inst-2025', year: 2025 }),
    assessmentRow({ assessmentId: 'a-2026', instrumentId: 'inst-2026', year: 2026 }),
  ];

  it('acota al año más reciente con resultados en vez de mezclar todo el historial', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      DOS_ANOS,
      [familyRow('inst-2025', { year: 2025 }), familyRow('inst-2026', { year: 2026 })],
      [...DIA_BANDS('inst-2025'), ...DIA_BANDS('inst-2026')],
      [],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    expect(result.filters.year).toBe(2026);
    expect(result.filters.allYears).toBe(false);
    expect(result.byAssessment.map((a) => a.assessmentId)).toEqual(['a-2026']);
    expect(result.filterOptions.years).toEqual([2026, 2025]);
  });

  it('con allYears deja pasar todos los años y deja de agregar por no ser comparable', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      DOS_ANOS,
      [familyRow('inst-2025', { year: 2025 }), familyRow('inst-2026', { year: 2026 })],
      [...DIA_BANDS('inst-2025'), ...DIA_BANDS('inst-2026')],
      [],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1', { allYears: true });

    expect(result.byAssessment).toHaveLength(2);
    expect(result.comparability.kind).toBe('instrument_family');
    expect(result.comparability.aggregatable).toBe(false);
    expect(result.summary.averageAchievement).toBeNull();
    expect(result.comparability.reason).toContain('no promediar');
  });

  it('arma la serie de momentos del ciclo dentro de la asignatura', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [
        assessmentRow({
          assessmentId: 'a-dg',
          instrumentId: 'inst-dg',
          applicationPeriod: 'diagnostico',
          achievement: '50.00',
        }),
        assessmentRow({
          assessmentId: 'a-cierre',
          instrumentId: 'inst-cierre',
          applicationPeriod: 'cierre',
          achievement: '80.00',
        }),
      ],
      [
        familyRow('inst-dg', { applicationPeriod: 'diagnostico' }),
        familyRow('inst-cierre', { applicationPeriod: 'cierre' }),
      ],
      [...DIA_BANDS('inst-dg'), ...DIA_BANDS('inst-cierre')],
      [],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    expect(result.bySubject).toHaveLength(1);
    const lenguaje = result.bySubject[0]!;
    expect(lenguaje.subjectName).toBe('Lenguaje');
    expect(lenguaje.assessmentsCount).toBe(2);
    expect(lenguaje.achievement).toBeNull();

    const serie = lenguaje.series.find((s) => s.kind === 'period_series');
    expect(serie).toBeDefined();
    expect(serie!.points.map((p) => p.label)).toEqual(['Diagnóstico', 'Cierre']);
    expect(serie!.points.map((p) => p.achievement)).toEqual([50, 80]);
  });

  it('separa el panorama por asignatura y filtra por una sola', async () => {
    const rows = [
      assessmentRow(),
      assessmentRow({
        assessmentId: 'a-mate',
        instrumentId: 'inst-mate',
        subjectId: 'subj-mate',
        subjectName: 'Matemática',
      }),
    ];

    const sinFiltro = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      rows,
      [familyRow('inst-1'), familyRow('inst-mate', { subjectId: 'subj-mate' })],
      [...DIA_BANDS('inst-1'), ...DIA_BANDS('inst-mate')],
      [],
    ]);
    const todas = await makeService(sinFiltro).getPanorama(makeUser(), 'stu-1');
    expect(todas.bySubject.map((s) => s.subjectName)).toEqual(['Lenguaje', 'Matemática']);
    expect(todas.filterOptions.subjects).toHaveLength(2);

    const conFiltro = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      rows,
      [familyRow('inst-mate', { subjectId: 'subj-mate' })],
      DIA_BANDS('inst-mate'),
      [],
    ]);
    const soloMate = await makeService(conFiltro).getPanorama(makeUser(), 'stu-1', {
      subjectId: 'subj-mate',
    });
    expect(soloMate.byAssessment.map((a) => a.assessmentId)).toEqual(['a-mate']);
    expect(soloMate.bySubject.map((s) => s.subjectName)).toEqual(['Matemática']);
    expect(soloMate.comparability.kind).toBe('single_assessment');
    expect(soloMate.summary.averageAchievement).toBe(70);
  });
});

describe('StudentPanoramaService — logro por habilidad', () => {
  it('deriva el logro del nodo desde los conteos de ítems, no de un promedio de porcentajes', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [assessmentRow()],
      [familyRow('inst-1')],
      DIA_BANDS('inst-1'),
      [skillRow({ nodeCode: 'LOC', correctCount: 6, totalCount: 12, assessmentsCount: 2 })],
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
      [assessmentRow()],
      [familyRow('inst-1')],
      DIA_BANDS('inst-1'),
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
      [assessmentRow()],
      [familyRow('inst-1')],
      DIA_BANDS('inst-1'),
      [
        skillRow({ nodeId: 'huerfano', nodeName: 'OA suelto', parentNodeId: 'eje-no-evaluado' }),
        skillRow({ nodeId: 'raiz', nodeName: 'Eje', parentNodeId: null }),
      ],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    expect(result.bySkillTree.map((n) => n.nodeId).sort()).toEqual(['huerfano', 'raiz']);
  });

  it('ordena las habilidades por logro ascendente y deja al final las sin medir', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [assessmentRow()],
      [familyRow('inst-1')],
      DIA_BANDS('inst-1'),
      [
        skillRow({ nodeId: 'n-alto', nodeName: 'Alto', correctCount: 9, totalCount: 10 }),
        skillRow({ nodeId: 'n-sin', nodeName: 'Sin medir', correctCount: 0, totalCount: 0 }),
        skillRow({ nodeId: 'n-bajo', nodeName: 'Bajo', correctCount: 2, totalCount: 10 }),
      ],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    expect(result.bySkill.map((s) => s.nodeId)).toEqual(['n-bajo', 'n-alto', 'n-sin']);
    expect(result.bySkill[2]?.achievement).toBeNull();
  });
});

describe('StudentPanoramaService — serie temporal por nodo de habilidad', () => {
  function seriesRow(overrides: Record<string, unknown> = {}) {
    return { assessmentId: 'a-dg', nodeId: 'node-1', percentage: '50.00', ...overrides };
  }

  it('adjunta la serie cronológica de un nodo evaluado en dos evaluaciones', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [
        assessmentRow({
          assessmentId: 'a-dg',
          instrumentId: 'inst-dg',
          applicationPeriod: 'diagnostico',
          administeredAt: new Date('2025-03-01'),
          year: 2025,
        }),
        assessmentRow({
          assessmentId: 'a-cierre',
          instrumentId: 'inst-cierre',
          applicationPeriod: 'cierre',
          administeredAt: new Date('2025-11-01'),
          year: 2025,
        }),
      ],
      [
        familyRow('inst-dg', { applicationPeriod: 'diagnostico', year: 2025 }),
        familyRow('inst-cierre', { applicationPeriod: 'cierre', year: 2025 }),
      ],
      [...DIA_BANDS('inst-dg'), ...DIA_BANDS('inst-cierre')],
      [skillRow({ nodeId: 'node-1', correctCount: 11, totalCount: 20, assessmentsCount: 2 })],
      [
        seriesRow({ assessmentId: 'a-cierre', nodeId: 'node-1', percentage: '80.00' }),
        seriesRow({ assessmentId: 'a-dg', nodeId: 'node-1', percentage: '40.00' }),
      ],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1', { allYears: true });

    const node = result.bySkillTree[0]!;
    expect(node.nodeId).toBe('node-1');
    expect(node.series).toEqual([
      { assessmentId: 'a-dg', label: 'Diagnóstico 2025', achievement: 40 },
      { assessmentId: 'a-cierre', label: 'Cierre 2025', achievement: 80 },
    ]);
  });

  it('adjunta una serie de un punto para un nodo evaluado en una sola evaluación', async () => {
    const db = makeDb([
      [STUDENT],
      [STUDENT],
      [ENROLLMENT],
      [assessmentRow({ assessmentId: 'a-1', applicationPeriod: 'diagnostico', year: 2026 })],
      [familyRow('inst-1')],
      DIA_BANDS('inst-1'),
      [skillRow({ nodeId: 'node-1' })],
      [seriesRow({ assessmentId: 'a-1', nodeId: 'node-1', percentage: '65.50' })],
    ]);

    const result = await makeService(db).getPanorama(makeUser(), 'stu-1');

    const node = result.bySkillTree[0]!;
    expect(node.series).toEqual([
      { assessmentId: 'a-1', label: 'Diagnóstico 2026', achievement: 65.5 },
    ]);
  });
});
