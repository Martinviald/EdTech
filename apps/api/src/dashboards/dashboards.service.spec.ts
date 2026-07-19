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
      // 2. métricas globales (per-alumno)
      [{ avgPct: '72.50', studentsEvaluated: 30 }],
      // 3. resultAssessmentIds (distinct assessment con datos per-alumno)
      [{ assessmentId: 'a1' }, { assessmentId: 'a2' }],
      // 4. loadCohortAchievementByAssessment — a1/a2 también en read-model (computed),
      //    ya contados per-alumno → no aportan N ni logro extra.
      [
        { assessmentId: 'a1', scoreSum: '0', maxSum: '0', studentsAssessed: 0 },
        { assessmentId: 'a2', scoreSum: '0', maxSum: '0', studentsAssessed: 0 },
      ],
      // 5. computePerformanceDistribution (group by level)
      [
        { level: 'adequate', count: 18 },
        { level: 'elementary', count: 12 },
      ],
      // 6. loadRecentAssessments → resolveScopedAssessmentIds
      [{ id: 'a1' }, { id: 'a2' }],
      // 7. loadRecentAssessments → assessments
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
      // 8. loadRecentAssessments → stats
      [{ assessmentId: 'a1', studentsCount: 30, avgPct: '72.50' }],
      // 9. loadRecentAssessments → cohorte (fallback para agregadas; acá no aplica)
      [],
      // 10. deriveAlerts → courseAchievement
      [{ classGroupId: 'cg1', classGroupName: '2°A', avgPct: '55.00' }],
      // 11. deriveAlerts → skills
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
    expect(res.recentAssessments[0]!.studentsCount).toBe(30);
    // Alertas: curso < 60 (low_achievement) + skill < 50 (critical_skill).
    expect(res.alerts).toHaveLength(2);
    expect(res.alerts.map((a) => a.type).sort()).toEqual(['critical_skill', 'low_achievement']);
  });

  // Espeja el fallback de `listAssessments`: una evaluación cargada desde un informe
  // oficial no tiene filas por alumno, y la tarjeta mostraba "0 alumnos" y logro "—".
  it('evaluación reciente agregada: N y logro salen del read-model de cohorte', async () => {
    const db = makeDb([
      [{ id: 'a1' }], // resolveScopedAssessmentIds
      [{ avgPct: null, studentsEvaluated: 0 }], // métricas per-alumno
      [], // resultAssessmentIds
      [{ assessmentId: 'a1', scoreSum: '820', maxSum: '2000', studentsAssessed: 41 }], // read-model
      [], // distribución
      [{ id: 'a1' }], // loadRecentAssessments → resolveScopedAssessmentIds
      [
        {
          assessmentId: 'a1',
          name: 'LANG diagnóstico 2025',
          administeredAt: new Date('2025-04-01'),
          createdAt: new Date('2025-04-01'),
          status: 'completed',
          instrumentName: 'DIA Lenguaje',
          instrumentType: 'dia',
          subjectName: 'Lenguaje',
          gradeName: '3° Básico',
        },
      ],
      [], // stats per-alumno: vacío (aggregate_only)
      [{ assessmentId: 'a1', scoreSum: '820', maxSum: '2000', studentsAssessed: 41 }], // cohorte
      [], // deriveAlerts → courseAchievement
      [], // deriveAlerts → skills
    ]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser({ activeRole: 'academic_director' }), {});

    expect(res.recentAssessments).toHaveLength(1);
    expect(res.recentAssessments[0]!.studentsCount).toBe(41);
    expect(res.recentAssessments[0]!.averageAchievement).toBeCloseTo(41, 6); // 820/2000
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
    const res = await svc.getOverview(makeUser({ activeRole: 'teacher', roles: ['teacher'] }), {});
    expect(res.scope).toBe('teacher');
    expect(res.studentsEvaluated).toBe(0);
    expect(res.assessmentsCount).toBe(0);
  });

  it('platform_admin sin org activa → vacío sin consultar la DB', async () => {
    const db = makeDb([]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser({ activeRole: 'platform_admin', orgId: null }), {});
    expect(res.scope).toBe('org');
    expect(res.assessmentsCount).toBe(0);
    expect(db.__selectIdx()).toBe(0); // ninguna query ejecutada
  });

  // ── Informes agregados (aggregate_only) — no tienen filas per-alumno ──────────
  it('org con SÓLO informes agregados: cuenta assessment y alumnos desde el read-model', async () => {
    const db = makeDb([
      // 1. resolveScopedAssessmentIds → el assessment agregado sí existe en `assessments`
      [{ id: 'a1' }],
      // 2. métricas per-alumno → sin resultados (informe agregado)
      [{ avgPct: null, studentsEvaluated: 0 }],
      // 3. resultAssessmentIds → ninguno
      [],
      // 4. loadCohortAchievementByAssessment → logro 150/200 = 75%, N = 25
      [{ assessmentId: 'a1', scoreSum: '150', maxSum: '200', studentsAssessed: 25 }],
      // 5+ resto (distribución, recientes, alertas) → vacío por defecto
    ]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser({ activeRole: 'academic_director' }), {});
    // Antes daban 0: ahora salen del read-model de cohorte.
    expect(res.assessmentsCount).toBe(1);
    expect(res.studentsEvaluated).toBe(25);
    expect(res.globalAchievement).toBe(75);
  });

  it('org mixta (item_level + agregado): cuenta ambos sin doble-contar', async () => {
    const db = makeDb([
      // 1. resolveScopedAssessmentIds → a1 (item_level) + a2 (agregado)
      [{ id: 'a1' }, { id: 'a2' }],
      // 2. métricas per-alumno de a1: 80% sobre 20 alumnos
      [{ avgPct: '80.00', studentsEvaluated: 20 }],
      // 3. resultAssessmentIds → sólo a1 tiene datos per-alumno
      [{ assessmentId: 'a1' }],
      // 4. read-model: a1 (computed, ya contado) + a2 (agregado, 90/200 = 45%, N 30)
      [
        { assessmentId: 'a1', scoreSum: '160', maxSum: '200', studentsAssessed: 20 },
        { assessmentId: 'a2', scoreSum: '90', maxSum: '200', studentsAssessed: 30 },
      ],
    ]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser({ activeRole: 'academic_director' }), {});
    // Unión {a1} ∪ {a1,a2} = 2 (a1 NO se cuenta dos veces).
    expect(res.assessmentsCount).toBe(2);
    // 20 (per-alumno de a1) + 30 (cohorte de a2); a1 del read-model no re-suma.
    expect(res.studentsEvaluated).toBe(50);
    // Ponderado: (80×20 + 45×30) / (20+30) = (1600 + 1350) / 50 = 59.
    expect(res.globalAchievement).toBeCloseTo(59, 6);
  });

  it('org item_level puro sin read-model: sin regresión respecto al cálculo per-alumno', async () => {
    const db = makeDb([
      // 1. resolveScopedAssessmentIds
      [{ id: 'a1' }],
      // 2. métricas per-alumno: 70% sobre 15 alumnos
      [{ avgPct: '70.00', studentsEvaluated: 15 }],
      // 3. resultAssessmentIds → a1
      [{ assessmentId: 'a1' }],
      // 4. read-model vacío (datos antiguos previos al backfill)
      [],
    ]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser({ activeRole: 'school_admin' }), {});
    expect(res.assessmentsCount).toBe(1);
    expect(res.studentsEvaluated).toBe(15);
    expect(res.globalAchievement).toBe(70);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getFilterOptions()
// ──────────────────────────────────────────────────────────────────────────────

describe('DashboardsService.getFilterOptions', () => {
  it('admin: devuelve cursos, asignaturas, instrumentos y períodos', async () => {
    const db = makeDb([
      // 1. resolveCatalogAcademicYear → años con cursos visibles
      [{ academicYearId: 'ay1', year: 2025, isCurrent: true }],
      // 2. classGroups + grades
      [
        {
          id: 'cg1',
          name: '2°A',
          gradeId: 'g1',
          academicYearId: 'ay1',
          gradeName: '2° Básico',
        },
      ],
      // 3. selectDistinct subjects
      [{ id: 'sub1', name: 'Lenguaje' }],
      // 4. instruments
      [
        {
          id: 'i1',
          name: 'DIA 2025 Lectura',
          type: 'dia',
          subjectId: 'sub1',
          gradeId: 'g1',
        },
      ],
      // 5. periods (academic_years)
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
    expect(res.defaultAcademicYearId).toBe('ay1');
  });

  // El catálogo de cursos se acota SIEMPRE a un año: `class_groups` es por año y
  // el nombre del curso ("A") no distingue 2025 de 2026.
  it('sin año pedido: usa el año vigente cuando tiene cursos', async () => {
    const db = makeDb([
      // resolveCatalogAcademicYear: 2026 vigente y con cursos, 2025 también tiene
      [
        { academicYearId: 'ay2026', year: 2026, isCurrent: true },
        { academicYearId: 'ay2025', year: 2025, isCurrent: false },
      ],
      [{ id: 'cg1', name: 'A', gradeId: 'g1', academicYearId: 'ay2026', gradeName: '3° Básico' }],
      [],
      [],
      [
        { id: 'ay2026', year: 2026, isCurrent: true },
        { id: 'ay2025', year: 2025, isCurrent: false },
      ],
    ]);
    const svc = makeService(db);
    const res = await svc.getFilterOptions(makeUser({ activeRole: 'school_admin' }), {});
    expect(res.defaultAcademicYearId).toBe('ay2026');
  });

  // Un año vigente recién abierto no tiene cursos todavía: sin este fallback el
  // catálogo saldría vacío y los dashboards en blanco pese a haber datos previos.
  it('año vigente sin cursos: cae al año más reciente que sí tenga', async () => {
    const db = makeDb([
      // 2026 es el vigente pero NO aparece acá (no tiene cursos); sí 2025.
      [{ academicYearId: 'ay2025', year: 2025, isCurrent: false }],
      [{ id: 'cg1', name: 'A', gradeId: 'g1', academicYearId: 'ay2025', gradeName: '3° Básico' }],
      [],
      [],
      [
        { id: 'ay2026', year: 2026, isCurrent: true },
        { id: 'ay2025', year: 2025, isCurrent: false },
      ],
    ]);
    const svc = makeService(db);
    const res = await svc.getFilterOptions(makeUser({ activeRole: 'school_admin' }), {});
    expect(res.defaultAcademicYearId).toBe('ay2025');
    expect(res.classGroups).toHaveLength(1);
  });

  it('año pedido explícitamente: lo respeta sin resolver el vigente', async () => {
    const db = makeDb([
      // Sin fila de resolveCatalogAcademicYear: no debe consultarse.
      [{ id: 'cg1', name: 'B', gradeId: 'g1', academicYearId: 'ay2025', gradeName: '3° Básico' }],
      [],
      [],
      [{ id: 'ay2025', year: 2025, isCurrent: false }],
    ]);
    const svc = makeService(db);
    const res = await svc.getFilterOptions(makeUser({ activeRole: 'school_admin' }), {
      academicYearId: 'ay2025',
    });
    expect(res.defaultAcademicYearId).toBe('ay2025');
    expect(res.classGroups[0]!.label).toBe('B');
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
      // 3. aggregateRows (group by student). La distribución se calcula en memoria
      //    a partir de esta clasificación (sin query separada).
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
      // 4. loadClassGroupByStudent
      [
        { studentId: 's1', classGroupId: 'cg1', classGroupName: '2°A' },
        { studentId: 's2', classGroupId: 'cg1', classGroupName: '2°A' },
      ],
      // 5. resolveScopedBands: >1 instrumento en scope → sin bandas (legacy)
      [{ instrumentId: 'i1' }, { instrumentId: 'i2' }],
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
      // resolveScopedBands: >1 instrumento → sin bandas (legacy)
      [{ instrumentId: 'i1' }, { instrumentId: 'i2' }],
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

// Fila del read-model ya agregada en SQL a (nodo × curso), como la devuelve
// `loadSkillsFromCohortStats`.
function cohortSkillRow(
  nodeId: string,
  classGroupPct: number,
  studentCount: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    nodeId,
    nodeName: 'Localizar información',
    nodeType: 'skill',
    nodeCode: 'OA1',
    parentId: null,
    pctSum: (classGroupPct * studentCount).toFixed(2),
    pctWeight: studentCount,
    studentsAssessed: studentCount,
    ...overrides,
  };
}

describe('DashboardsService.getSkills', () => {
  it('agrega el read-model de cohorte por nodo con promedio y alumnos evaluados', async () => {
    const db = makeDb([
      // 1. resolveScopedAssessmentIds
      [{ id: 'a1' }],
      // 2. resolveThresholds → resolveApplicableScale (sin escala → null)
      [],
      // 3. resolveScopedBands: >1 instrumento → sin bandas (legacy)
      [{ instrumentId: 'i1' }, { instrumentId: 'i2' }],
      // 4. assessment_skill_stats agrupado por (nodo × curso)
      [cohortSkillRow('n1', 75, 20)],
    ]);
    const svc = makeService(db);
    const res = await svc.getSkills(makeUser({ activeRole: 'academic_director' }), {});
    expect(res.skills).toHaveLength(1);
    expect(res.skills[0]!.nodeName).toBe('Localizar información');
    expect(res.skills[0]!.averageAchievement).toBe(75);
    expect(res.skills[0]!.studentsAssessed).toBe(20);
    expect(res.skills[0]!.performanceLevel).toBe('adequate'); // 0.75 ∈ [0.70,0.85)
  });

  // ⚠️ El invariante de la Fase 5: recombinar cursos NO puede mover el número.
  it('pondera por studentCount al recombinar cursos de distinto N (no promedia %)', async () => {
    const db = makeDb([
      [{ id: 'a1' }],
      [],
      [{ instrumentId: 'i1' }, { instrumentId: 'i2' }],
      // Mismo nodo, dos cursos de N muy distinto: 90% con 10 alumnos y 40% con 30.
      // Ponderado (lo que hacía avg() por alumno): (900 + 1200) / 40 = 52.5.
      // Promedio simple de los % de cada curso daría 65 → sería un número movido.
      [cohortSkillRow('n1', 90, 10), cohortSkillRow('n1', 40, 30)],
    ]);
    const svc = makeService(db);
    const res = await svc.getSkills(makeUser({ activeRole: 'academic_director' }), {});
    expect(res.skills).toHaveLength(1);
    expect(res.skills[0]!.averageAchievement).toBeCloseTo(52.5, 6);
    expect(res.skills[0]!.studentsAssessed).toBe(40);
  });

  // `count(distinct student_id)` de antes cuenta al alumno UNA vez aunque haya rendido
  // dos evaluaciones. El SQL ya trae `max(student_count)` por curso; el fold suma esos
  // max entre cursos, nunca entre evaluaciones.
  it('no duplica alumnos evaluados cuando el scope abarca varias evaluaciones', async () => {
    const db = makeDb([
      [{ id: 'a1' }, { id: 'a2' }],
      [],
      [{ instrumentId: 'i1' }, { instrumentId: 'i2' }],
      // Una fila por curso (el max sobre las 2 evaluaciones ya lo hizo SQL).
      [cohortSkillRow('n1', 60, 20), cohortSkillRow('n1', 60, 25)],
    ]);
    const svc = makeService(db);
    const res = await svc.getSkills(makeUser({ activeRole: 'academic_director' }), {});
    expect(res.skills[0]!.studentsAssessed).toBe(45);
  });

  it('nodo sin porcentajes (pctWeight 0) → promedio null sin nivel', async () => {
    const db = makeDb([
      [{ id: 'a1' }],
      [],
      [{ instrumentId: 'i1' }, { instrumentId: 'i2' }],
      [cohortSkillRow('n1', 0, 0, { pctSum: null, pctWeight: 0, studentsAssessed: 0 })],
    ]);
    const svc = makeService(db);
    const res = await svc.getSkills(makeUser({ activeRole: 'academic_director' }), {});
    expect(res.skills[0]!.averageAchievement).toBeNull();
    expect(res.skills[0]!.performanceLevel).toBeNull();
  });

  // El read-model tiene grano curso: acotar a UN alumno exige skill_results.
  it('con filtro studentId cae al camino por alumno (skill_results)', async () => {
    const db = makeDb([
      // 1. resolveScopedStudentIds (hay filtro de alumno → sí consulta)
      [{ studentId: 's1' }],
      // 2. resolveScopedAssessmentIds
      [{ id: 'a1' }],
      // 3. resolveThresholds → sin escala
      [],
      // 4. resolveScopedBands → >1 instrumento
      [{ instrumentId: 'i1' }, { instrumentId: 'i2' }],
      // 5. skill_results agrupado por nodo (forma vieja: avgPct + count distinct)
      [
        {
          nodeId: 'n1',
          nodeName: 'Localizar información',
          nodeType: 'skill',
          nodeCode: 'OA1',
          parentId: null,
          avgPct: '75.00',
          studentsAssessed: 1,
        },
      ],
    ]);
    const svc = makeService(db);
    const res = await svc.getSkills(makeUser({ activeRole: 'academic_director' }), {
      studentId: 's1',
    });
    expect(res.skills[0]!.averageAchievement).toBe(75);
    expect(res.skills[0]!.studentsAssessed).toBe(1);
    expect(db.__selectIdx()).toBe(5);
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

  it('teacher con cursos: resuelve sus class_groups y agrega el read-model', async () => {
    const db = makeDb([
      // 1. getAccessibleClassGroupIds
      [{ classGroupId: 'cg1' }],
      // 2. resolveScopedClassGroupIds
      [{ id: 'cg1' }],
      // 3. resolveScopedAssessmentIds
      [{ id: 'a1' }],
      // 4. resolveThresholds
      [],
      // 5. resolveScopedBands
      [{ instrumentId: 'i1' }, { instrumentId: 'i2' }],
      // 6. read-model
      [cohortSkillRow('n1', 80, 18)],
    ]);
    const svc = makeService(db);
    const res = await svc.getSkills(makeUser({ activeRole: 'teacher', roles: ['teacher'] }), {});
    expect(res.skills[0]!.averageAchievement).toBe(80);
    expect(res.skills[0]!.studentsAssessed).toBe(18);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getSkillBreakdown()  (drill-down jerárquico)
// ──────────────────────────────────────────────────────────────────────────────

describe('DashboardsService.getSkillBreakdown', () => {
  it('desglosa el nodo por curso: mapea promedio, nivel, sublabel y alumnos', async () => {
    const db = makeDb([
      // 1. metadata del nodo
      [{ name: 'Localizar información', type: 'skill', code: 'OA1' }],
      // 2. resolveScopedAssessmentIds
      [{ id: 'a1' }],
      // 3. resolveThresholds → resolveApplicableScale (sin escala → defaults)
      [],
      // 4. breakdown por classGroup sobre assessment_skill_stats
      [
        {
          id: 'cg1',
          name: '2°A',
          gradeName: '2° Básico',
          pctSum: '1440.00',
          pctWeight: 18,
          studentsAssessed: 18,
        },
        {
          id: 'cg2',
          name: '2°B',
          gradeName: '2° Básico',
          pctSum: '525.00',
          pctWeight: 15,
          studentsAssessed: 15,
        },
      ],
    ]);
    const svc = makeService(db);
    const res = await svc.getSkillBreakdown(makeUser({ activeRole: 'academic_director' }), {
      nodeId: 'n1',
      groupBy: 'classGroup',
    });
    expect(res.node.nodeName).toBe('Localizar información');
    expect(res.groupBy).toBe('classGroup');
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]!).toMatchObject({
      id: 'cg1',
      label: '2°A',
      sublabel: '2° Básico',
      averageAchievement: 80,
      studentsAssessed: 18,
      performanceLevel: 'adequate', // 0.80 ∈ [0.70, 0.85)
    });
    expect(res.rows[1]!.performanceLevel).toBe('insufficient'); // 0.35 < 0.40
  });

  it('usa el nombre del instrumento como fallback cuando la evaluación no tiene nombre', async () => {
    const db = makeDb([
      [{ name: 'Comprensión', type: 'skill', code: null }],
      [{ id: 'a1' }],
      [],
      // breakdown por assessment con name null — dos cursos de la MISMA evaluación,
      // que el fold recombina en una sola fila ponderando por pctWeight.
      [
        {
          id: 'a1',
          name: null,
          instrumentName: 'DIA Lenguaje 2°',
          subjectName: 'Lenguaje',
          pctSum: '1400.00', // 70% × 20 alumnos
          pctWeight: 20,
          studentsAssessed: 20,
        },
        {
          id: 'a1',
          name: null,
          instrumentName: 'DIA Lenguaje 2°',
          subjectName: 'Lenguaje',
          pctSum: '400.00', // 40% × 10 alumnos
          pctWeight: 10,
          studentsAssessed: 10,
        },
      ],
    ]);
    const svc = makeService(db);
    const res = await svc.getSkillBreakdown(makeUser({ activeRole: 'school_admin' }), {
      nodeId: 'n1',
      groupBy: 'assessment',
    });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.label).toBe('DIA Lenguaje 2°');
    expect(res.rows[0]!.sublabel).toBe('Lenguaje');
    // (1400 + 400) / 30 = 60 — no 55, que sería el promedio simple de 70 y 40.
    expect(res.rows[0]!.averageAchievement).toBeCloseTo(60, 6);
    expect(res.rows[0]!.studentsAssessed).toBe(30);
  });

  it('teacher sin asignaciones → rows vacío (pero node se resuelve)', async () => {
    const db = makeDb([
      // metadata del nodo
      [{ name: 'Localizar', type: 'skill', code: 'OA1' }],
      // getAccessibleClassGroupIds (teacher) → vacío
      [],
    ]);
    const svc = makeService(db);
    const res = await svc.getSkillBreakdown(
      makeUser({ activeRole: 'teacher', roles: ['teacher'] }),
      { nodeId: 'n1', groupBy: 'grade' },
    );
    expect(res.node.nodeName).toBe('Localizar');
    expect(res.rows).toEqual([]);
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
