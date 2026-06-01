import { NotFoundException, ForbiddenException } from '@nestjs/common';
import type { Database } from '@soe/db';
import type { JwtPayload, } from '../auth/jwt-payload.types';
import type { UserRole } from '@soe/types';
import { AssessmentResultsService } from './assessment-results.service';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers: construir un Database mock por escenario.
//
// El service llama a `db.select(...).from(...)....where(...).limit(1)` en
// muchos lugares. Para mantener los tests legibles, construimos un mock que
// devuelve un cliente cuyas funciones encadenables (`select`, `from`, `where`,
// `innerJoin`, `leftJoin`, `orderBy`, `limit`, `offset`) retornan ellas mismas
// y al final una promesa que resuelve a un array configurable.
//
// `__queues` define la respuesta para cada llamada a `select()` en orden — el
// service ejecuta múltiples queries por método; cada test agenda las
// respuestas en el orden esperado.
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
  orderBy: (..._: unknown[]) => QueryBuilder;
  limit: (..._: unknown[]) => QueryBuilder;
  offset: (..._: unknown[]) => QueryBuilder;
  then: <T>(resolve: (rows: T[]) => unknown) => Promise<unknown>;
};

type InsertChain = {
  values: (rows: unknown[]) => Promise<unknown> & { returning?: () => Promise<unknown[]> };
};
type DeleteChain = { where: (..._: unknown[]) => Promise<unknown> };

type DbMock = Database & {
  __selectCalls: number;
  __selectResults: unknown[][];
  __insertCalls: Array<{ table: unknown; rows: unknown[] }>;
  __deleteCalls: Array<{ table: unknown }>;
  __transactionRan: boolean;
};

function makeDb(selectResults: unknown[][]): DbMock {
  let selectIdx = 0;
  const insertCalls: Array<{ table: unknown; rows: unknown[] }> = [];
  const deleteCalls: Array<{ table: unknown }> = [];

  function buildSelectChain(rows: unknown[]): QueryBuilder {
    const chain: QueryBuilder = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
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
    insert: (table: unknown): InsertChain => ({
      values: (rows: unknown[]) => {
        insertCalls.push({ table, rows });
        return Promise.resolve({}) as ReturnType<InsertChain['values']>;
      },
    }),
    delete: (table: unknown): DeleteChain => ({
      where: () => {
        deleteCalls.push({ table });
        return Promise.resolve({});
      },
    }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      db.__transactionRan = true;
      return fn(db);
    },
    __selectCalls: 0,
    __selectResults: selectResults,
    __insertCalls: insertCalls,
    __deleteCalls: deleteCalls,
    __transactionRan: false,
  } as unknown as DbMock;

  return db;
}

function makeService(db: Database): AssessmentResultsService {
  // El @InjectDb es metadata — pasamos el db directo al constructor.
  return new (AssessmentResultsService as new (db: Database) => AssessmentResultsService)(db);
}

// ──────────────────────────────────────────────────────────────────────────────
// calculate()
// ──────────────────────────────────────────────────────────────────────────────

describe('AssessmentResultsService.calculate', () => {
  it('lanza NotFoundException si el assessment no existe', async () => {
    const db = makeDb([
      [], // requireAssessmentOwnedByUser → []
    ]);
    const svc = makeService(db);
    await expect(
      svc.calculate(makeUser(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', { force: false }),
    ).rejects.toThrow(NotFoundException);
  });

  it('lanza NotFoundException si el assessment pertenece a otra org (multi-tenancy)', async () => {
    const db = makeDb([
      [{ id: 'a1', orgId: 'OTHER-ORG', instrumentId: 'i1' }],
    ]);
    const svc = makeService(db);
    await expect(
      svc.calculate(makeUser({ orgId: 'org-1' }), 'a1', { force: false }),
    ).rejects.toThrow(NotFoundException);
  });

  it('aplica el calculador puro y persiste con batch insert + transacción', async () => {
    const db = makeDb([
      // 1) requireAssessmentOwnedByUser
      [{ id: 'a1', orgId: 'org-1', instrumentId: 'i1' }],
      // 2) responses + items
      [
        { studentId: 's1', itemId: 'it1', isCorrect: true, rawScore: '1.00', finalScore: '1.00', maxScore: '1.00', itemPosition: 1 },
        { studentId: 's1', itemId: 'it2', isCorrect: false, rawScore: '0.00', finalScore: '0.00', maxScore: '1.00', itemPosition: 2 },
        { studentId: 's2', itemId: 'it1', isCorrect: true, rawScore: '1.00', finalScore: '1.00', maxScore: '1.00', itemPosition: 1 },
        { studentId: 's2', itemId: 'it2', isCorrect: true, rawScore: '1.00', finalScore: '1.00', maxScore: '1.00', itemPosition: 2 },
      ],
      // 3) itemTaxonomyTags
      [
        { itemId: 'it1', nodeId: 'n1' },
        { itemId: 'it2', nodeId: 'n1' },
        { itemId: 'it2', nodeId: 'n2' },
      ],
      // 4) prior counts (single row)
      [{ priorResults: 0, priorSkillResults: 0 }],
      // 5) resolveGradingScale: no dto.gradingScaleId, busca instrument
      // (resolveGradingScale es llamado ANTES de "responses" según el código);
      // ajustamos: el orden real es requireAssessment, getAccessibleClassGroupIds (skipped admin), resolveGradingScale, responses query…
      // Por simplicidad para este test, instrument gradingScaleId = null → fallback default.
    ]);
    // Necesitamos arreglar el orden: el service llama:
    //   1. requireAssessmentOwnedByUser     → select 1
    //   2. (admin-like, no select)
    //   3. resolveGradingScale: NO dto.gradingScaleId, → select instrument (2), no scale → default
    //   4. responses + items                 → select 3
    //   5. loadTagsByItemId                  → select 4
    //   6. priorResults                      → select 5
    // Rehacemos el mock con el orden correcto:
    const db2 = makeDb([
      [{ id: 'a1', orgId: 'org-1', instrumentId: 'i1' }], // 1
      [{ gradingScaleId: null }],                          // 2 (instruments)
      // 3 (responses+items)
      [
        { studentId: 's1', itemId: 'it1', isCorrect: true, rawScore: '1.00', finalScore: '1.00', maxScore: '1.00', itemPosition: 1 },
        { studentId: 's1', itemId: 'it2', isCorrect: false, rawScore: '0.00', finalScore: '0.00', maxScore: '1.00', itemPosition: 2 },
        { studentId: 's2', itemId: 'it1', isCorrect: true, rawScore: '1.00', finalScore: '1.00', maxScore: '1.00', itemPosition: 1 },
        { studentId: 's2', itemId: 'it2', isCorrect: true, rawScore: '1.00', finalScore: '1.00', maxScore: '1.00', itemPosition: 2 },
      ],
      // 4 (tags)
      [
        { itemId: 'it1', nodeId: 'n1' },
        { itemId: 'it2', nodeId: 'n1' },
        { itemId: 'it2', nodeId: 'n2' },
      ],
      // 5 (prior counts)
      [{ priorResults: 0, priorSkillResults: 0 }],
    ]);

    // El service en realidad llama responses ANTES de prior counts. Hagamos el orden real:
    // Mirando el código:
    //   requireAssessment (sel 1)
    //   resolveGradingScale (sel 2)
    //   responses+items (sel 3)
    //   (early return si vacío — no aplica)
    //   loadTagsByItemId (sel 4)
    //   priorResults sql (sel 5)
    // (Coincide.) Usamos db2.
    void db;

    const svc = makeService(db2);
    const result = await svc.calculate(
      makeUser({ activeRole: 'school_admin' }),
      'a1',
      { force: false },
    );

    expect(result.studentsProcessed).toBe(2);
    expect(result.assessmentId).toBe('a1');
    expect(db2.__transactionRan).toBe(true);

    // El service debe insertar TODOS los aggregates en UN SOLO insert por tabla
    // (batch). Esperamos 2 inserts (assessmentResults + skillResults).
    expect(db2.__insertCalls).toHaveLength(2);
    expect(db2.__insertCalls[0]!.rows).toHaveLength(2); // 2 students en assessmentResults
    expect(db2.__insertCalls[1]!.rows.length).toBeGreaterThanOrEqual(2); // skillResults por student×nodo

    // También debe haber borrado los previos (idempotencia del recálculo).
    expect(db2.__deleteCalls).toHaveLength(2);
  });

  it('cae al default linear_chilean cuando no hay escala en dto ni en el instrument', async () => {
    const db = makeDb([
      [{ id: 'a1', orgId: 'org-1', instrumentId: 'i1' }], // 1: assessment
      [{ gradingScaleId: null }],                          // 2: instrument sin escala
      [
        { studentId: 's1', itemId: 'it1', isCorrect: true, rawScore: '1.00', finalScore: '1.00', maxScore: '1.00', itemPosition: 1 },
      ],
      [],                                                  // 4: tags vacío
      [{ priorResults: 0, priorSkillResults: 0 }],         // 5: prior counts
    ]);
    const svc = makeService(db);
    const result = await svc.calculate(makeUser(), 'a1', { force: false });
    // Con default 1-7, threshold 0.6, 100% → 7.0.
    expect(result.studentsProcessed).toBe(1);
    const inserted = db.__insertCalls[0]!.rows as Array<{ grade: string }>;
    expect(inserted[0]!.grade).toBe('7.00');
  });

  it('retorna 0/0 sin transacción cuando no hay responses', async () => {
    const db = makeDb([
      [{ id: 'a1', orgId: 'org-1', instrumentId: 'i1' }], // assessment
      [{ gradingScaleId: null }],                         // instrument
      [],                                                 // responses vacío
    ]);
    const svc = makeService(db);
    const result = await svc.calculate(makeUser(), 'a1', { force: false });
    expect(result).toEqual({
      assessmentId: 'a1',
      resultsCreated: 0,
      resultsUpdated: 0,
      skillResultsCreated: 0,
      skillResultsUpdated: 0,
      studentsProcessed: 0,
    });
    expect(db.__transactionRan).toBe(false);
    expect(db.__insertCalls).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// list()
// ──────────────────────────────────────────────────────────────────────────────

describe('AssessmentResultsService.list', () => {
  it('retorna paginado con studentFullName joineado (admin-like)', async () => {
    const db = makeDb([
      [{ id: 'a1', orgId: 'org-1', instrumentId: 'i1' }], // requireAssessment
      // count
      [{ total: 2 }],
      // rows
      [
        {
          id: 'r1',
          assessmentId: 'a1',
          studentId: 's1',
          studentRut: '11.111.111-1',
          firstName: 'Ana',
          lastName: 'Pérez',
          totalScore: '5.00',
          maxScore: '10.00',
          percentage: '50.00',
          grade: '4.00',
          performanceLevel: 'elementary',
          isComplete: true,
          completedAt: new Date('2025-01-01'),
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
        {
          id: 'r2',
          assessmentId: 'a1',
          studentId: 's2',
          studentRut: '22.222.222-2',
          firstName: 'Luis',
          lastName: 'Soto',
          totalScore: '8.00',
          maxScore: '10.00',
          percentage: '80.00',
          grade: '6.30',
          performanceLevel: 'adequate',
          isComplete: true,
          completedAt: new Date('2025-01-01'),
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
      ],
    ]);
    const svc = makeService(db);
    const resp = await svc.list(makeUser({ activeRole: 'academic_director' }), 'a1', {
      page: 1,
      limit: 50,
    });
    expect(resp.total).toBe(2);
    expect(resp.data).toHaveLength(2);
    expect(resp.data[0]!.studentFullName).toBe('Ana Pérez');
    expect(resp.data[1]!.studentFullName).toBe('Luis Soto');
  });

  it('aplica scoping de profesor (teacher ve sólo sus class_groups)', async () => {
    const db = makeDb([
      // 1. requireAssessment
      [{ id: 'a1', orgId: 'org-1', instrumentId: 'i1' }],
      // 2. getAccessibleClassGroupIds (teacher_assignments)
      [{ classGroupId: 'cg-A' }, { classGroupId: 'cg-A' }],
      // 3. resolveAccessibleStudentIds → studentEnrollments
      [{ studentId: 's1' }],
      // 4. count
      [{ total: 1 }],
      // 5. rows
      [
        {
          id: 'r1',
          assessmentId: 'a1',
          studentId: 's1',
          studentRut: '11.111.111-1',
          firstName: 'Ana',
          lastName: 'Pérez',
          totalScore: '5.00',
          maxScore: '10.00',
          percentage: '50.00',
          grade: '4.00',
          performanceLevel: 'elementary',
          isComplete: true,
          completedAt: new Date('2025-01-01'),
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
      ],
    ]);
    const svc = makeService(db);
    const resp = await svc.list(makeUser({ activeRole: 'teacher', roles: ['teacher'] }), 'a1', {
      page: 1,
      limit: 50,
    });
    expect(resp.total).toBe(1);
    expect(resp.data[0]!.studentId).toBe('s1');
  });

  it('teacher sin asignaciones retorna lista vacía sin filtrar PII de otros cursos', async () => {
    const db = makeDb([
      [{ id: 'a1', orgId: 'org-1', instrumentId: 'i1' }], // assessment
      [],                                                  // teacher_assignments vacío
    ]);
    const svc = makeService(db);
    const resp = await svc.list(
      makeUser({ activeRole: 'teacher', roles: ['teacher'] }),
      'a1',
      { page: 1, limit: 50 },
    );
    expect(resp.total).toBe(0);
    expect(resp.data).toEqual([]);
  });

  it('admin user (academic_director) no consulta teacher_assignments y ve todos los cursos', async () => {
    const db = makeDb([
      [{ id: 'a1', orgId: 'org-1', instrumentId: 'i1' }], // assessment
      // sin select adicional para teacher_assignments — scope.scopeAll = true
      [{ total: 5 }], // count
      [],             // rows (no nos importa el contenido en este test)
    ]);
    const svc = makeService(db);
    const resp = await svc.list(
      makeUser({ activeRole: 'academic_director', roles: ['academic_director'] }),
      'a1',
      { page: 1, limit: 50 },
    );
    expect(resp.total).toBe(5);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getStudentDetail()
// ──────────────────────────────────────────────────────────────────────────────

describe('AssessmentResultsService.getStudentDetail', () => {
  it('lanza 404 si el alumno no tiene resultado en esta evaluación', async () => {
    const db = makeDb([
      [{ id: 'a1', orgId: 'org-1', instrumentId: 'i1' }], // assessment
      // admin-like → no teacher_assignments select
      [],                                                  // resultRow vacío
    ]);
    const svc = makeService(db);
    await expect(
      svc.getStudentDetail(
        makeUser({ activeRole: 'school_admin' }),
        'a1',
        '11111111-1111-1111-1111-111111111111',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('teacher sin acceso al alumno recibe 404 (no filtra existencia entre cursos)', async () => {
    const db = makeDb([
      [{ id: 'a1', orgId: 'org-1', instrumentId: 'i1' }], // assessment
      [{ classGroupId: 'cg-A' }],                         // teacher_assignments
      [],                                                  // enrollment lookup vacío → 404
    ]);
    const svc = makeService(db);
    await expect(
      svc.getStudentDetail(
        makeUser({ activeRole: 'teacher', roles: ['teacher'] }),
        'a1',
        '99999999-9999-9999-9999-999999999999',
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// listSkillResults()
// ──────────────────────────────────────────────────────────────────────────────

describe('AssessmentResultsService.listSkillResults', () => {
  it('joinea taxonomy_nodes para devolver nodeName + nodeType', async () => {
    const db = makeDb([
      [{ id: 'a1', orgId: 'org-1', instrumentId: 'i1' }],
      // count
      [{ total: 1 }],
      // rows
      [
        {
          id: 'sr1',
          assessmentId: 'a1',
          studentId: 's1',
          nodeId: 'n1',
          nodeName: 'Localizar información',
          nodeType: 'skill',
          correctCount: 3,
          totalCount: 4,
          percentage: '75.00',
          performanceLevel: 'adequate',
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
      ],
    ]);
    const svc = makeService(db);
    const resp = await svc.listSkillResults(
      makeUser({ activeRole: 'academic_director' }),
      'a1',
      { page: 1, limit: 50 },
    );
    expect(resp.total).toBe(1);
    expect(resp.data[0]!.nodeName).toBe('Localizar información');
    expect(resp.data[0]!.nodeType).toBe('skill');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// calculate(): ForbiddenException si teacher sin asignaciones
// ──────────────────────────────────────────────────────────────────────────────

describe('AssessmentResultsService.calculate teacher scoping', () => {
  it('lanza ForbiddenException si el caller teacher no tiene class_groups asignados', async () => {
    const db = makeDb([
      [{ id: 'a1', orgId: 'org-1', instrumentId: 'i1' }], // assessment
      [],                                                  // teacher_assignments vacío
    ]);
    const svc = makeService(db);
    await expect(
      svc.calculate(makeUser({ activeRole: 'teacher', roles: ['teacher'] }), 'a1', {
        force: false,
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
