import { ForbiddenException } from '@nestjs/common';
import type { Database } from '@soe/db';
import type { UserRole } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { AnalyticsService } from './analytics.service';

// ──────────────────────────────────────────────────────────────────────────────
// Mock de Database: cada llamada a `select()` consume la siguiente respuesta de
// `selectResults` en orden. El builder es encadenable (from/where/innerJoin/
// groupBy/orderBy/limit) y resuelve a un array al hacer `await`/`.then`.
// Igual estilo que assessment-results.service.spec.ts.
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

type DbMock = Database & { __selectCalls: () => number };

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
    __selectCalls: () => selectIdx,
  } as unknown as DbMock;

  return db;
}

function makeService(db: Database): AnalyticsService {
  return new (AnalyticsService as new (db: Database) => AnalyticsService)(db);
}

const GRADE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NODE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const STUDENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CLASS_GROUP_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

// ──────────────────────────────────────────────────────────────────────────────
// generational()  (H6.3)
// ──────────────────────────────────────────────────────────────────────────────

describe('AnalyticsService.generational', () => {
  it('arma la serie ordenada por año con múltiples períodos', async () => {
    const db = makeDb([
      // resolveGenerationalMeta → grades
      [{ name: '3° Básico' }],
      // resolveScopePassingGrade → grading scale aplicable
      [{ passingGrade: '4.00' }],
      // generationalSeriesFromResults → filas por año
      [
        {
          academicYearId: 'ay-2024',
          year: 2024,
          avgPct: '62.50',
          studentsCount: 20,
          totalGraded: 20,
          passingCount: 12,
        },
        {
          academicYearId: 'ay-2025',
          year: 2025,
          avgPct: '70.00',
          studentsCount: 22,
          totalGraded: 22,
          passingCount: 18,
        },
      ],
      // generationalDistributionFromResults → distribución por nivel
      [
        { academicYearId: 'ay-2024', level: 'insufficient', count: 8 },
        { academicYearId: 'ay-2024', level: 'adequate', count: 12 },
        { academicYearId: 'ay-2025', level: 'adequate', count: 18 },
        { academicYearId: 'ay-2025', level: 'advanced', count: 4 },
      ],
    ]);
    const svc = makeService(db);

    const res = await svc.generational(makeUser(), { gradeId: GRADE_ID });

    expect(res.gradeId).toBe(GRADE_ID);
    expect(res.gradeName).toBe('3° Básico');
    expect(res.series).toHaveLength(2);
    expect(res.series[0].year).toBe(2024);
    expect(res.series[1].year).toBe(2025);
    expect(res.series[0].averageAchievement).toBe(62.5);
    expect(res.series[0].passingRate).toBe(60); // 12/20
    expect(res.series[1].passingRate).toBeCloseTo((18 / 22) * 100);
    // Distribución 2024: insufficient 8 + adequate 12 = 20
    const dist2024 = res.series[0].performanceDistribution;
    expect(dist2024).toHaveLength(4);
    const insuf = dist2024.find((d) => d.level === 'insufficient')!;
    expect(insuf.count).toBe(8);
    expect(insuf.percentage).toBe(40);
  });

  it('devuelve un único punto cuando sólo existe un período (válido)', async () => {
    const db = makeDb([
      [{ name: '4° Básico' }], // meta
      [{ passingGrade: '4.00' }], // resolveScopePassingGrade
      [
        {
          academicYearId: 'ay-2025',
          year: 2025,
          avgPct: '55.00',
          studentsCount: 15,
          totalGraded: 15,
          passingCount: 9,
        },
      ],
      [], // distribución vacía
    ]);
    const svc = makeService(db);

    const res = await svc.generational(makeUser(), { gradeId: GRADE_ID });

    expect(res.series).toHaveLength(1);
    expect(res.series[0].averageAchievement).toBe(55);
    // Sin filas de distribución → buckets en cero pero presentes (4 niveles).
    expect(res.series[0].performanceDistribution).toHaveLength(4);
    expect(
      res.series[0].performanceDistribution.every((d) => d.count === 0),
    ).toBe(true);
  });

  it('devuelve serie vacía cuando no hay datos para el grade', async () => {
    const db = makeDb([
      [{ name: '5° Básico' }], // meta
      [{ passingGrade: '4.00' }], // resolveScopePassingGrade
      [], // sin filas → serie vacía
      [], // distribución vacía
    ]);
    const svc = makeService(db);

    const res = await svc.generational(makeUser(), { gradeId: GRADE_ID });
    expect(res.series).toHaveLength(0);
  });

  it('usa skill_results y passingRate=null cuando se filtra por nodeId', async () => {
    const db = makeDb([
      [{ name: '3° Básico' }], // grade
      [{ name: 'Lectura literal' }], // node (resolveGenerationalMeta consulta nodo)
      // generationalSeriesFromSkills → filas
      [
        {
          academicYearId: 'ay-2025',
          year: 2025,
          avgPct: '48.00',
          studentsCount: 18,
        },
      ],
      // distribución skills
      [{ academicYearId: 'ay-2025', level: 'elementary', count: 18 }],
    ]);
    const svc = makeService(db);

    const res = await svc.generational(makeUser(), {
      gradeId: GRADE_ID,
      nodeId: NODE_ID,
    });

    expect(res.nodeId).toBe(NODE_ID);
    expect(res.nodeName).toBe('Lectura literal');
    expect(res.series[0].averageAchievement).toBe(48);
    expect(res.series[0].passingRate).toBeNull();
  });

  it('profesor sin cursos asignados → serie vacía (scoping)', async () => {
    const db = makeDb([
      // getAccessibleClassGroupIds → teacher_assignments vacío (va primero)
      [],
      // resolveGenerationalMeta → grade
      [{ name: '3° Básico' }],
    ]);
    const svc = makeService(db);

    const res = await svc.generational(makeUser({ activeRole: 'teacher' }), {
      gradeId: GRADE_ID,
    });
    expect(res.series).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// progression()  (H6.6)
// ──────────────────────────────────────────────────────────────────────────────

describe('AnalyticsService.progression', () => {
  it('scope=student: serie de % logro ordenada por administeredAt', async () => {
    const db = makeDb([
      // isStudentVisible → student exists (admin → scopeAll, no enrollment check)
      [{ id: STUDENT_ID }],
      // student name
      [{ firstName: 'Ana', lastName: 'Pérez' }],
      // assessment_results rows
      [
        {
          assessmentId: 'a1',
          assessmentName: 'DIA Inicial',
          instrumentName: 'DIA Lenguaje',
          administeredAt: new Date('2025-03-01'),
          achievement: '50.00',
          performanceLevel: 'elementary',
        },
        {
          assessmentId: 'a2',
          assessmentName: 'DIA Intermedio',
          instrumentName: 'DIA Lenguaje',
          administeredAt: new Date('2025-07-01'),
          achievement: '72.00',
          performanceLevel: 'adequate',
        },
      ],
    ]);
    const svc = makeService(db);

    const res = await svc.progression(makeUser(), {
      scope: 'student',
      studentId: STUDENT_ID,
    });

    expect(res.scope).toBe('student');
    expect(res.entityId).toBe(STUDENT_ID);
    expect(res.entityLabel).toBe('Ana Pérez');
    expect(res.points).toHaveLength(2);
    expect(res.points[0].achievement).toBe(50);
    expect(res.points[1].achievement).toBe(72);
    expect(res.points[1].performanceLevel).toBe('adequate');
  });

  it('scope=student: profesor sin acceso al alumno → ForbiddenException', async () => {
    const db = makeDb([
      // getAccessibleClassGroupIds (teacher) → un curso asignado (va primero)
      [{ classGroupId: CLASS_GROUP_ID }],
      // isStudentVisible: student exists in org
      [{ id: STUDENT_ID }],
      // enrollment check para isStudentVisible → vacío (no pertenece)
      [],
    ]);
    const svc = makeService(db);

    await expect(
      svc.progression(makeUser({ activeRole: 'teacher' }), {
        scope: 'student',
        studentId: STUDENT_ID,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('scope=class: promedio del curso por evaluación, nivel derivado', async () => {
    const db = makeDb([
      // class_group lookup (name)
      [{ name: '3°A' }],
      // promedios por evaluación
      [
        {
          assessmentId: 'a1',
          assessmentName: 'DIA',
          instrumentName: 'DIA Lenguaje',
          administeredAt: new Date('2025-03-01'),
          avgPct: '65.00',
        },
      ],
    ]);
    const svc = makeService(db);

    const res = await svc.progression(makeUser(), {
      scope: 'class',
      classGroupId: CLASS_GROUP_ID,
    });

    expect(res.scope).toBe('class');
    expect(res.entityId).toBe(CLASS_GROUP_ID);
    expect(res.entityLabel).toBe('3°A');
    expect(res.points).toHaveLength(1);
    expect(res.points[0].achievement).toBe(65);
    // 65% → con thresholds default (0.4/0.7/0.85) → 'elementary'
    expect(res.points[0].performanceLevel).toBe('elementary');
  });

  it('scope=class: profesor sin acceso al curso → ForbiddenException', async () => {
    const db = makeDb([
      // getAccessibleClassGroupIds (teacher) → curso DISTINTO
      [{ classGroupId: 'otro-cg' }],
    ]);
    const svc = makeService(db);

    await expect(
      svc.progression(makeUser({ activeRole: 'teacher' }), {
        scope: 'class',
        classGroupId: CLASS_GROUP_ID,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('scope=skill: promedio del nodo por evaluación', async () => {
    const db = makeDb([
      // node lookup
      [{ name: 'Comprensión lectora' }],
      // skillStudentFilter: admin → scopeAll (no query). NO consume select.
      // skill_results promedio por evaluación
      [
        {
          assessmentId: 'a1',
          assessmentName: 'DIA',
          instrumentName: 'DIA Lenguaje',
          administeredAt: new Date('2025-03-01'),
          avgPct: '80.00',
        },
        {
          assessmentId: 'a2',
          assessmentName: 'DIA 2',
          instrumentName: 'DIA Lenguaje',
          administeredAt: new Date('2025-07-01'),
          avgPct: '90.00',
        },
      ],
    ]);
    const svc = makeService(db);

    const res = await svc.progression(makeUser(), {
      scope: 'skill',
      nodeId: NODE_ID,
    });

    expect(res.scope).toBe('skill');
    expect(res.entityId).toBe(NODE_ID);
    expect(res.entityLabel).toBe('Comprensión lectora');
    expect(res.points).toHaveLength(2);
    expect(res.points[0].achievement).toBe(80);
    expect(res.points[1].performanceLevel).toBe('advanced'); // 90% ≥ 0.85
  });

  it('scope=skill: profesor sin cursos → puntos vacíos', async () => {
    const db = makeDb([
      // getAccessibleClassGroupIds (teacher) → sin cursos (va primero)
      [],
      // node lookup
      [{ name: 'Comprensión lectora' }],
      // skillStudentFilter no llega a consultar enrollments (classGroupIds vacío)
    ]);
    const svc = makeService(db);

    const res = await svc.progression(makeUser({ activeRole: 'teacher' }), {
      scope: 'skill',
      nodeId: NODE_ID,
    });
    expect(res.points).toHaveLength(0);
  });

  it('lanza ForbiddenException si el usuario no tiene orgId', async () => {
    const db = makeDb([]);
    const svc = makeService(db);
    await expect(
      svc.progression(makeUser({ orgId: null, activeRole: 'teacher' }), {
        scope: 'skill',
        nodeId: NODE_ID,
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
