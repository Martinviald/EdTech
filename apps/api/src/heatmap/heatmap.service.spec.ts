import type { Database } from '@soe/db';
import type { UserRole } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { HeatmapService } from './heatmap.service';

// ──────────────────────────────────────────────────────────────────────────────
// Mock de Database por escenario (mismo patrón que dashboards.service.spec):
// cada llamada a `select()` consume el siguiente array de `selectResults` en
// orden. Las funciones encadenables retornan el chain y al resolver entregan las
// filas configuradas.
//
// Orden de queries en getHeatmap():
//   admin/scopeAll, sin filtro de curso → [cells, overall]
//   admin con classGroupId/academicYearId → [students, cells, overall]
//   teacher → [scope, students, cells, overall]
//   (early returns: profesor sin cursos = [scope]; sin datos = [..., cells=[]])
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

type DbMock = Database & { __selectIdx: () => number };

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
    // withOrgContext() abre una transacción y fija app.current_org_id vía
    // tx.execute antes de correr el callback. El tx es el propio mock.
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    __selectIdx: () => selectIdx,
  } as unknown as DbMock;

  return db;
}

function makeService(db: Database): HeatmapService {
  return new (HeatmapService as new (db: Database) => HeatmapService)(db);
}

// Helpers de filas crudas.
function cell(
  nodeId: string,
  nodeName: string,
  subjectId: string,
  subjectName: string,
  avgPct: string | null,
  studentsAssessed: number,
) {
  return {
    nodeId,
    nodeName,
    nodeType: 'skill',
    nodeCode: null,
    subjectId,
    subjectName,
    avgPct,
    studentsAssessed,
  };
}

describe('HeatmapService.getHeatmap', () => {
  // ── Happy path: matriz habilidad × asignatura (admin) ──────────────────────
  it('happy path admin: arma la matriz con celdas en el orden de subjects', async () => {
    const db = makeDb([
      // 1. cells (group by node, subject)
      [
        cell('n1', 'Comprensión', 's-leng', 'Lenguaje', '80.00', 10),
        cell('n1', 'Comprensión', 's-mat', 'Matemática', '60.00', 8),
        cell('n2', 'Localizar', 's-leng', 'Lenguaje', '45.00', 10),
      ],
      // 2. overall (group by node)
      [
        { nodeId: 'n1', avgPct: '71.00' },
        { nodeId: 'n2', avgPct: '45.00' },
      ],
    ]);
    const service = makeService(db);

    const res = await service.getHeatmap(makeUser(), {});

    // Subjects ordenados por nombre: Lenguaje, Matemática.
    expect(res.subjects.map((s) => s.subjectId)).toEqual(['s-leng', 's-mat']);
    // 2 filas.
    expect(res.rows).toHaveLength(2);

    const n1 = res.rows.find((r) => r.nodeId === 'n1')!;
    // cells en el MISMO orden que subjects.
    expect(n1.cells.map((c) => c.subjectId)).toEqual(['s-leng', 's-mat']);
    expect(n1.cells[0].averageAchievement).toBe(80);
    expect(n1.cells[1].averageAchievement).toBe(60);
  });

  // ── Celda sin datos rellenada con null/0 ───────────────────────────────────
  it('rellena con null/0 las celdas de una habilidad sin datos en una asignatura', async () => {
    const db = makeDb([
      [
        cell('n1', 'Comprensión', 's-leng', 'Lenguaje', '80.00', 10),
        cell('n1', 'Comprensión', 's-mat', 'Matemática', '60.00', 8),
        cell('n2', 'Localizar', 's-leng', 'Lenguaje', '45.00', 10),
      ],
      [
        { nodeId: 'n1', avgPct: '71.00' },
        { nodeId: 'n2', avgPct: '45.00' },
      ],
    ]);
    const service = makeService(db);

    const res = await service.getHeatmap(makeUser(), {});

    const n2 = res.rows.find((r) => r.nodeId === 'n2')!;
    expect(n2.cells.map((c) => c.subjectId)).toEqual(['s-leng', 's-mat']);
    // n2 no tiene datos en Matemática.
    expect(n2.cells[1]).toEqual({
      subjectId: 's-mat',
      averageAchievement: null,
      performanceLevel: null,
      studentsAssessed: 0,
    });
  });

  // ── Orden por criticidad (overallAchievement asc) ──────────────────────────
  it('ordena las filas por overallAchievement ascendente (críticas primero)', async () => {
    const db = makeDb([
      [
        cell('n1', 'Comprensión', 's-leng', 'Lenguaje', '80.00', 10),
        cell('n2', 'Localizar', 's-leng', 'Lenguaje', '45.00', 10),
        cell('n3', 'Inferir', 's-leng', 'Lenguaje', '30.00', 10),
      ],
      [
        { nodeId: 'n1', avgPct: '80.00' },
        { nodeId: 'n2', avgPct: '45.00' },
        { nodeId: 'n3', avgPct: '30.00' },
      ],
    ]);
    const service = makeService(db);

    const res = await service.getHeatmap(makeUser(), {});

    expect(res.rows.map((r) => r.nodeId)).toEqual(['n3', 'n2', 'n1']);
  });

  // ── Nodos sin datos van al final ───────────────────────────────────────────
  it('coloca los nodos sin overall (null) al final del orden', async () => {
    const db = makeDb([
      [
        cell('n1', 'Comprensión', 's-leng', 'Lenguaje', '50.00', 10),
        cell('n2', 'Localizar', 's-leng', 'Lenguaje', null, 0),
      ],
      [
        { nodeId: 'n1', avgPct: '50.00' },
        { nodeId: 'n2', avgPct: null },
      ],
    ]);
    const service = makeService(db);

    const res = await service.getHeatmap(makeUser(), {});

    expect(res.rows.map((r) => r.nodeId)).toEqual(['n1', 'n2']);
    expect(res.rows[1].overallAchievement).toBeNull();
    expect(res.rows[1].overallPerformanceLevel).toBeNull();
  });

  // ── Nivel de desempeño derivado correctamente ──────────────────────────────
  it('deriva el performanceLevel correcto desde el % logro (umbrales DIA)', async () => {
    const db = makeDb([
      [
        cell('n1', 'Adv', 's-leng', 'Lenguaje', '90.00', 10), // >=85 advanced
        cell('n2', 'Adq', 's-leng', 'Lenguaje', '75.00', 10), // 70-84 adequate
        cell('n3', 'Ele', 's-leng', 'Lenguaje', '50.00', 10), // 40-69 elementary
        cell('n4', 'Ins', 's-leng', 'Lenguaje', '30.00', 10), // <40 insufficient
      ],
      [
        { nodeId: 'n1', avgPct: '90.00' },
        { nodeId: 'n2', avgPct: '75.00' },
        { nodeId: 'n3', avgPct: '50.00' },
        { nodeId: 'n4', avgPct: '30.00' },
      ],
    ]);
    const service = makeService(db);

    const res = await service.getHeatmap(makeUser(), {});

    const lvl = (id: string) =>
      res.rows.find((r) => r.nodeId === id)!.cells[0].performanceLevel;
    expect(lvl('n1')).toBe('advanced');
    expect(lvl('n2')).toBe('adequate');
    expect(lvl('n3')).toBe('elementary');
    expect(lvl('n4')).toBe('insufficient');
    // overall también.
    expect(res.rows.find((r) => r.nodeId === 'n4')!.overallPerformanceLevel).toBe(
      'insufficient',
    );
  });

  // ── filtro subjectId → una sola columna ────────────────────────────────────
  it('con subjectId devuelve una sola columna (la asignatura filtrada)', async () => {
    const db = makeDb([
      [
        cell('n1', 'Comprensión', 's-leng', 'Lenguaje', '80.00', 10),
        cell('n2', 'Localizar', 's-leng', 'Lenguaje', '45.00', 10),
      ],
      [
        { nodeId: 'n1', avgPct: '80.00' },
        { nodeId: 'n2', avgPct: '45.00' },
      ],
    ]);
    const service = makeService(db);

    const res = await service.getHeatmap(makeUser(), { subjectId: 's-leng' });

    expect(res.subjects).toHaveLength(1);
    expect(res.subjects[0].subjectId).toBe('s-leng');
    res.rows.forEach((r) => expect(r.cells).toHaveLength(1));
  });

  // ── Sin datos → respuesta vacía ────────────────────────────────────────────
  it('sin skill_results en el scope devuelve { subjects: [], rows: [] }', async () => {
    const db = makeDb([
      // cells vacío → early return (no se consulta overall)
      [],
    ]);
    const service = makeService(db);

    const res = await service.getHeatmap(makeUser(), {});

    expect(res).toEqual({ subjects: [], rows: [] });
    // overall NO se consultó.
    expect(db.__selectIdx()).toBe(1);
  });

  // ── Scoping profesor SIN cursos → vacío sin tocar agregaciones ─────────────
  it('profesor sin cursos asignados devuelve vacío sin consultar la matriz', async () => {
    const db = makeDb([
      // 1. getAccessibleClassGroupIds → sin cursos
      [],
    ]);
    const service = makeService(db);

    const res = await service.getHeatmap(makeUser({ role: 'teacher' }), {});

    expect(res).toEqual({ subjects: [], rows: [] });
    // Sólo se consultó el scope; no studentIds, cells ni overall.
    expect(db.__selectIdx()).toBe(1);
  });

  // ── Scoping profesor CON cursos → arma matriz restringida a sus alumnos ─────
  it('profesor con cursos: resuelve scope + alumnos y arma la matriz', async () => {
    const db = makeDb([
      // 1. getAccessibleClassGroupIds → 1 curso
      [{ classGroupId: 'cg-1' }],
      // 2. resolveScopedStudentIds → alumnos del curso
      [{ studentId: 'st-1' }, { studentId: 'st-2' }],
      // 3. cells
      [cell('n1', 'Comprensión', 's-leng', 'Lenguaje', '65.00', 2)],
      // 4. overall
      [{ nodeId: 'n1', avgPct: '65.00' }],
    ]);
    const service = makeService(db);

    const res = await service.getHeatmap(makeUser({ role: 'teacher' }), {});

    expect(db.__selectIdx()).toBe(4);
    expect(res.subjects.map((s) => s.subjectId)).toEqual(['s-leng']);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].cells[0].averageAchievement).toBe(65);
    expect(res.rows[0].cells[0].performanceLevel).toBe('elementary');
  });

  // ── Profesor con cursos pero sin alumnos → vacío ───────────────────────────
  it('profesor con cursos pero sin alumnos matriculados devuelve vacío', async () => {
    const db = makeDb([
      // 1. scope → 1 curso
      [{ classGroupId: 'cg-1' }],
      // 2. studentIds → vacío
      [],
    ]);
    const service = makeService(db);

    const res = await service.getHeatmap(makeUser({ role: 'teacher' }), {});

    expect(res).toEqual({ subjects: [], rows: [] });
    expect(db.__selectIdx()).toBe(2);
  });

  // ── org_id del token: usuario sin org → Forbidden ──────────────────────────
  it('usuario sin orgId en el token lanza ForbiddenException', async () => {
    const db = makeDb([]);
    const service = makeService(db);

    await expect(
      service.getHeatmap(makeUser({ orgId: null }), {}),
    ).rejects.toThrow('Usuario sin organización asociada');
  });

  // ── admin con classGroupId resuelve studentIds antes de la matriz ──────────
  it('admin con classGroupId resuelve alumnos del curso antes de agregar', async () => {
    const db = makeDb([
      // 1. resolveScopedStudentIds (scopeAll + filtro de curso)
      [{ studentId: 'st-1' }],
      // 2. cells
      [cell('n1', 'Comprensión', 's-leng', 'Lenguaje', '88.00', 1)],
      // 3. overall
      [{ nodeId: 'n1', avgPct: '88.00' }],
    ]);
    const service = makeService(db);

    const res = await service.getHeatmap(makeUser(), { classGroupId: 'cg-1' });

    expect(db.__selectIdx()).toBe(3);
    expect(res.rows[0].cells[0].performanceLevel).toBe('advanced');
  });
});
