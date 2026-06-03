import type { Database } from '@soe/db';
import type { UserRole } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { DashboardsService } from './dashboards.service';

// ──────────────────────────────────────────────────────────────────────────────
// Mock de Database por escenario. Mismo patrón que assessment-results.spec:
// cada llamada a `select()`/`selectDistinct()` consume el siguiente array de
// `selectResults` en orden. Las funciones encadenables (from, where, innerJoin,
// leftJoin, groupBy, orderBy, limit, offset) retornan el propio chain y al
// resolver entregan las filas configuradas.
// ──────────────────────────────────────────────────────────────────────────────

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
  offset: (..._: unknown[]) => QueryBuilder;
  then: <T>(resolve: (rows: T[]) => unknown) => Promise<unknown>;
};

type DbMock = Database & {
  __selectIdx: () => number;
};

function makeDb(selectResults: unknown[][]): DbMock {
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
      offset: () => chain,
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
    selectDistinct: () => {
      const rows = selectResults[selectIdx] ?? [];
      selectIdx++;
      return buildSelectChain(rows);
    },
    // withOrgContext() abre una transacción y fija app.current_org_id vía
    // tx.execute antes de correr el callback. El tx es el propio mock.
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    __selectIdx: () => selectIdx,
  } as unknown as DbMock;

  return db;
}

function makeService(db: Database): DashboardsService {
  return new (DashboardsService as new (db: Database) => DashboardsService)(db);
}

// ──────────────────────────────────────────────────────────────────────────────
// getOverview()
// ──────────────────────────────────────────────────────────────────────────────

describe('DashboardsService.getOverview', () => {
  it('happy path admin: agrega métricas, distribución y scope=org', async () => {
    const db = makeDb([
      // 1. resolveScopedAssessmentIds (assessments+instruments)
      [{ id: 'a1' }, { id: 'a2' }],
      // 2. métricas globales
      [{ avgPct: '72.50', studentsEvaluated: 30, assessmentsCount: 2 }],
      // 3. computePerformanceDistribution (group by level)
      [
        { level: 'adequate', count: 18 },
        { level: 'elementary', count: 12 },
      ],
      // 4. loadRecentAssessments → resolveScopedAssessmentIds
      [{ id: 'a1' }, { id: 'a2' }],
      // 5. loadRecentAssessments → assessments
      [
        {
          assessmentId: 'a1',
          name: 'DIA Lectura',
          administeredAt: new Date('2025-03-01'),
          createdAt: new Date('2025-03-01'),
          status: 'completed',
          instrumentName: 'DIA 2025 Lectura',
          instrumentType: 'dia',
          subjectName: 'Lenguaje',
          gradeName: '2° Básico',
        },
      ],
      // 6. loadRecentAssessments → stats
      [{ assessmentId: 'a1', studentsCount: 30, avgPct: '72.50' }],
      // 7. deriveAlerts → courseAchievement
      [{ classGroupId: 'cg1', classGroupName: '2°A', avgPct: '55.00' }],
      // 8. deriveAlerts → skills
      [{ nodeId: 'n1', nodeName: 'Inferir', avgPct: '40.00' }],
    ]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser({ activeRole: 'academic_director' }), {});

    expect(res.scope).toBe('org');
    expect(res.globalAchievement).toBe(72.5);
    expect(res.studentsEvaluated).toBe(30);
    expect(res.assessmentsCount).toBe(2);
    // Distribución cubre los 4 niveles, ordenada por PERFORMANCE_LEVELS.
    expect(res.performanceDistribution).toHaveLength(4);
    const adequate = res.performanceDistribution.find((b) => b.level === 'adequate')!;
    expect(adequate.count).toBe(18);
    expect(adequate.percentage).toBeCloseTo(60);
    expect(res.recentAssessments).toHaveLength(1);
    expect(res.recentAssessments[0]!.instrumentName).toBe('DIA 2025 Lectura');
    // Alertas: curso < 60 (low_achievement) + skill < 50 (critical_skill).
    expect(res.alerts).toHaveLength(2);
    expect(res.alerts.map((a) => a.type).sort()).toEqual(['critical_skill', 'low_achievement']);
  });

  it('sin evaluaciones que matcheen → overview vacío con distribución de ceros', async () => {
    const db = makeDb([
      // resolveScopedAssessmentIds → vacío
      [],
    ]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser({ activeRole: 'school_admin' }), {});
    expect(res.assessmentsCount).toBe(0);
    expect(res.globalAchievement).toBeNull();
    expect(res.studentsEvaluated).toBe(0);
    expect(res.recentAssessments).toEqual([]);
    expect(res.alerts).toEqual([]);
    expect(res.performanceDistribution.every((b) => b.count === 0)).toBe(true);
  });

  it('teacher sin asignaciones → scope=teacher y datos vacíos (no filtra PII)', async () => {
    const db = makeDb([
      // getAccessibleClassGroupIds → teacher_assignments vacío
      [],
    ]);
    const svc = makeService(db);
    const res = await svc.getOverview(
      makeUser({ activeRole: 'teacher', roles: ['teacher'] }),
      {},
    );
    expect(res.scope).toBe('teacher');
    expect(res.studentsEvaluated).toBe(0);
    expect(res.assessmentsCount).toBe(0);
  });

  it('platform_admin sin org activa → vacío sin consultar la DB', async () => {
    const db = makeDb([]);
    const svc = makeService(db);
    const res = await svc.getOverview(
      makeUser({ activeRole: 'platform_admin', orgId: null }),
      {},
    );
    expect(res.scope).toBe('org');
    expect(res.assessmentsCount).toBe(0);
    expect(db.__selectIdx()).toBe(0); // ninguna query ejecutada
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getFilterOptions()
// ──────────────────────────────────────────────────────────────────────────────

describe('DashboardsService.getFilterOptions', () => {
  it('admin: devuelve cursos, asignaturas, instrumentos y períodos', async () => {
    const db = makeDb([
      // 1. classGroups + grades
      [
        {
          id: 'cg1',
          name: '2°A',
          gradeId: 'g1',
          academicYearId: 'ay1',
          gradeName: '2° Básico',
        },
      ],
      // 2. selectDistinct subjects
      [{ id: 'sub1', name: 'Lenguaje' }],
      // 3. instruments
      [
        {
          id: 'i1',
          name: 'DIA 2025 Lectura',
          type: 'dia',
          subjectId: 'sub1',
          gradeId: 'g1',
        },
      ],
      // 4. periods (academic_years)
      [{ id: 'ay1', year: 2025, isCurrent: true }],
    ]);
    const svc = makeService(db);
    const res = await svc.getFilterOptions(makeUser({ activeRole: 'academic_director' }), {});

    expect(res.classGroups).toHaveLength(1);
    expect(res.classGroups[0]!.label).toBe('2°A');
    expect(res.grades).toEqual([{ id: 'g1', label: '2° Básico' }]);
    expect(res.subjects).toEqual([{ id: 'sub1', label: 'Lenguaje' }]);
    expect(res.instruments[0]!.type).toBe('dia');
    expect(res.periods).toEqual([{ id: 'ay1', year: 2025, label: '2025', isCurrent: true }]);
  });

  it('teacher sin cursos → sólo expone períodos, sin cursos ni asignaturas', async () => {
    const db = makeDb([
      // getAccessibleClassGroupIds → vacío
      [],
      // loadPeriods
      [{ id: 'ay1', year: 2025, isCurrent: true }],
    ]);
    const svc = makeService(db);
    const res = await svc.getFilterOptions(
      makeUser({ activeRole: 'teacher', roles: ['teacher'] }),
      {},
    );
    expect(res.classGroups).toEqual([]);
    expect(res.subjects).toEqual([]);
    expect(res.periods).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getPerformance()
// ──────────────────────────────────────────────────────────────────────────────

describe('DashboardsService.getPerformance', () => {
  it('clasifica alumnos por promedio, pagina y aplica thresholds default', async () => {
    const db = makeDb([
      // 1. resolveScopedAssessmentIds
      [{ id: 'a1' }],
      // 2. resolveThresholds → resolveApplicableScale (sin escala → null)
      [],
      // 3. computePerformanceDistribution
      [
        { level: 'advanced', count: 1 },
        { level: 'insufficient', count: 1 },
      ],
      // 4. aggregateRows (group by student)
      [
        {
          studentId: 's1',
          studentRut: '11.111.111-1',
          firstName: 'Ana',
          lastName: 'Pérez',
          avgPct: '90.00',
          avgGrade: '6.50',
        },
        {
          studentId: 's2',
          studentRut: '22.222.222-2',
          firstName: 'Luis',
          lastName: 'Soto',
          avgPct: '30.00',
          avgGrade: '3.00',
        },
      ],
      // 5. loadClassGroupByStudent
      [
        { studentId: 's1', classGroupId: 'cg1', classGroupName: '2°A' },
        { studentId: 's2', classGroupId: 'cg1', classGroupName: '2°A' },
      ],
    ]);
    const svc = makeService(db);
    const res = await svc.getPerformance(makeUser({ activeRole: 'school_admin' }), {
      page: 1,
      limit: 50,
    });

    expect(res.thresholds).toEqual({ elementary: 0.4, adequate: 0.7, advanced: 0.85 });
    expect(res.students.total).toBe(2);
    expect(res.students.data).toHaveLength(2);
    const ana = res.students.data.find((s) => s.studentId === 's1')!;
    expect(ana.studentFullName).toBe('Ana Pérez');
    expect(ana.achievement).toBe(90);
    expect(ana.performanceLevel).toBe('advanced'); // 0.90 >= 0.85
    expect(ana.classGroupName).toBe('2°A');
    const luis = res.students.data.find((s) => s.studentId === 's2')!;
    expect(luis.performanceLevel).toBe('insufficient'); // 0.30 < 0.40
  });

  it('filtra por performanceLevel sobre el promedio del alumno', async () => {
    const db = makeDb([
      // resolveScopedAssessmentIds
      [{ id: 'a1' }],
      // resolveThresholds → scale null
      [],
      // distribution
      [],
      // aggregateRows
      [
        {
          studentId: 's1',
          studentRut: '1-1',
          firstName: 'Ana',
          lastName: 'Pérez',
          avgPct: '90.00',
          avgGrade: '6.50',
        },
        {
          studentId: 's2',
          studentRut: '2-2',
          firstName: 'Luis',
          lastName: 'Soto',
          avgPct: '30.00',
          avgGrade: '3.00',
        },
      ],
      // loadClassGroupByStudent
      [],
    ]);
    const svc = makeService(db);
    const res = await svc.getPerformance(makeUser({ activeRole: 'school_admin' }), {
      page: 1,
      limit: 50,
      performanceLevel: 'insufficient',
    });
    expect(res.students.total).toBe(1);
    expect(res.students.data[0]!.studentId).toBe('s2');
  });

  it('sin evaluaciones → distribución vacía y lista vacía paginada', async () => {
    const db = makeDb([
      // resolveScopedAssessmentIds → vacío
      [],
      // resolveThresholds (assessmentIds vacío → scale null sin query)
    ]);
    const svc = makeService(db);
    const res = await svc.getPerformance(makeUser({ activeRole: 'school_admin' }), {
      page: 1,
      limit: 50,
    });
    expect(res.students.total).toBe(0);
    expect(res.students.data).toEqual([]);
    expect(res.distribution.every((b) => b.count === 0)).toBe(true);
    expect(res.thresholds).toEqual({ elementary: 0.4, adequate: 0.7, advanced: 0.85 });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getSkills()
// ──────────────────────────────────────────────────────────────────────────────

describe('DashboardsService.getSkills', () => {
  it('agrega skill_results por nodo con promedio y alumnos evaluados', async () => {
    const db = makeDb([
      // 1. resolveScopedAssessmentIds
      [{ id: 'a1' }],
      // 2. skills grouped
      [
        {
          nodeId: 'n1',
          nodeName: 'Localizar información',
          nodeType: 'skill',
          nodeCode: 'OA1',
          parentId: null,
          avgPct: '75.00',
          studentsAssessed: 20,
        },
      ],
    ]);
    const svc = makeService(db);
    const res = await svc.getSkills(makeUser({ activeRole: 'academic_director' }), {});
    expect(res.skills).toHaveLength(1);
    expect(res.skills[0]!.nodeName).toBe('Localizar información');
    expect(res.skills[0]!.averageAchievement).toBe(75);
    expect(res.skills[0]!.studentsAssessed).toBe(20);
    expect(res.skills[0]!.performanceLevel).toBe('adequate'); // 0.75 ∈ [0.70,0.85)
  });

  it('teacher sin asignaciones → skills vacío', async () => {
    const db = makeDb([
      // getAccessibleClassGroupIds → vacío
      [],
    ]);
    const svc = makeService(db);
    const res = await svc.getSkills(makeUser({ activeRole: 'teacher', roles: ['teacher'] }), {});
    expect(res.skills).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getTeacherKpis()
// ──────────────────────────────────────────────────────────────────────────────

describe('DashboardsService.getTeacherKpis', () => {
  it('una fila por curso con passingRate, criticalStudents y promedio', async () => {
    const db = makeDb([
      // 1. courseRows (classGroups + grades)
      [{ classGroupId: 'cg1', classGroupName: '2°A', gradeName: '2° Básico' }],
      // 2. loadSubjectNamesByClassGroup
      [{ classGroupId: 'cg1', subjectName: 'Lenguaje' }],
      // 3. resolvePassingGrade → resolveScopedAssessmentIds
      [{ id: 'a1' }],
      // 4. resolvePassingGrade → resolveApplicableScale (null → default 4.0)
      [],
      // 5. resolveScopedAssessmentIds (segunda llamada, en getTeacherKpis)
      [{ id: 'a1' }],
      // 6. studentRows del curso
      [{ studentId: 's1' }, { studentId: 's2' }],
      // 7. agg por curso
      [
        {
          avgPct: '65.00',
          assessmentsCount: 1,
          totalResults: 2,
          passingResults: 1,
          criticalStudents: 1,
        },
      ],
    ]);
    const svc = makeService(db);
    const res = await svc.getTeacherKpis(makeUser({ activeRole: 'academic_director' }), {});
    expect(res.courses).toHaveLength(1);
    const c = res.courses[0]!;
    expect(c.classGroupName).toBe('2°A');
    expect(c.subjectName).toBe('Lenguaje');
    expect(c.studentsCount).toBe(2);
    expect(c.averageAchievement).toBe(65);
    expect(c.passingRate).toBe(50); // 1 de 2 resultados aprobados
    expect(c.criticalStudents).toBe(1);
    expect(c.assessmentsCount).toBe(1);
  });

  it('curso sin evaluaciones → métricas en null/0 pero la fila existe', async () => {
    const db = makeDb([
      // courseRows
      [{ classGroupId: 'cg1', classGroupName: '2°A', gradeName: '2° Básico' }],
      // loadSubjectNamesByClassGroup
      [],
      // resolvePassingGrade → resolveScopedAssessmentIds (vacío)
      [],
      // resolveApplicableScale no se consulta (assessmentIds vacío)
      // resolveScopedAssessmentIds (segunda) → vacío
      [],
      // studentRows
      [{ studentId: 's1' }],
    ]);
    const svc = makeService(db);
    const res = await svc.getTeacherKpis(makeUser({ activeRole: 'school_admin' }), {});
    expect(res.courses).toHaveLength(1);
    expect(res.courses[0]!.averageAchievement).toBeNull();
    expect(res.courses[0]!.passingRate).toBeNull();
    expect(res.courses[0]!.criticalStudents).toBe(0);
    expect(res.courses[0]!.assessmentsCount).toBe(0);
  });

  it('teacher sin asignaciones → courses vacío', async () => {
    const db = makeDb([
      // getAccessibleClassGroupIds → vacío
      [],
    ]);
    const svc = makeService(db);
    const res = await svc.getTeacherKpis(
      makeUser({ activeRole: 'teacher', roles: ['teacher'] }),
      {},
    );
    expect(res.courses).toEqual([]);
  });
});
