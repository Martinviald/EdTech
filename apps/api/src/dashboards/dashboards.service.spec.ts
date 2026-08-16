import { PgDialect } from 'drizzle-orm/pg-core';
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
  /** SQL compilado del `where` de la n-ésima query, para assertar predicados. */
  __whereSql: (selectNumber: number) => string;
};

const dialect = new PgDialect();

function makeDb(selectResults: unknown[][]): DbMock {
  let selectIdx = 0;
  const whereBySelect = new Map<number, unknown>();

  function buildSelectChain(rows: unknown[], selectNumber: number): QueryBuilder {
    const chain: QueryBuilder = {
      from: () => chain,
      where: (...args: unknown[]) => {
        whereBySelect.set(selectNumber, args[0]);
        return chain;
      },
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
      return buildSelectChain(rows, selectIdx);
    },
    selectDistinct: () => {
      const rows = selectResults[selectIdx] ?? [];
      selectIdx++;
      return buildSelectChain(rows, selectIdx);
    },
    // withOrgContext() abre una transacción y fija app.current_org_id vía
    // tx.execute antes de correr el callback. El tx es el propio mock.
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    __selectIdx: () => selectIdx,
    __whereSql: (selectNumber: number) => {
      const condition = whereBySelect.get(selectNumber);
      if (!condition) return '';
      return dialect.sqlToQuery(condition as Parameters<PgDialect['sqlToQuery']>[0]).sql;
    },
  } as unknown as DbMock;

  return db;
}

/**
 * Fila de `resolveScopedAssessments`: la evaluación JUNTO CON su instrumento. Los
 * campos del instrumento deciden la comparabilidad del alcance, así que un test que
 * quiera un alcance NO comparable debe pasar instrumentos distintos a propósito.
 */
function scopedAssessment(
  id: string,
  instrumentId = 'i1',
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    instrumentId,
    instrumentType: 'dia',
    instrumentSubjectId: 's1',
    instrumentGradeId: 'g1',
    instrumentApplicationPeriod: null,
    instrumentYear: 2026,
    ...overrides,
  };
}

function makeService(db: Database): DashboardsService {
  return new (DashboardsService as new (db: Database) => DashboardsService)(db);
}

/**
 * Fila de `loadFamilyRows` (dentro de `resolveEffectiveBands`): el instrumento con su
 * familia. Con bandas propias, la resolución termina en `source:'own'` sin buscar la
 * versión anterior.
 */
function familyRow(instrumentId = 'i1', overrides: Record<string, unknown> = {}) {
  return {
    id: instrumentId,
    type: 'dia',
    subjectId: 's1',
    gradeId: 'g1',
    applicationPeriod: null,
    year: 2026,
    ...overrides,
  };
}

/** Fila de `performance_bands` como la trae `loadBandsForInstruments`. */
function bandRow(
  key: string,
  order: number,
  minThreshold: string,
  maxThreshold: string,
  instrumentId = 'i1',
) {
  return {
    id: `b-${key}`,
    orgId: null,
    key,
    label: key,
    order,
    minThreshold,
    maxThreshold,
    color: null,
    instrumentId,
  };
}

/** Set de bandas DIA de 3 niveles (I/II/III), cortes 0 / 0.5 / 0.8. */
function diaThreeBands(instrumentId = 'i1') {
  return [
    bandRow('I', 0, '0', '0.5', instrumentId),
    bandRow('II', 1, '0.5', '0.8', instrumentId),
    bandRow('III', 2, '0.8', '1', instrumentId),
  ];
}

// ──────────────────────────────────────────────────────────────────────────────
// getOverview()
// ──────────────────────────────────────────────────────────────────────────────

describe('DashboardsService.getOverview', () => {
  it('happy path admin: agrega conteos, distribución y scope=org', async () => {
    const db = makeDb([
      // 1. resolveScopedAssessments (assessments+instruments)
      [scopedAssessment('a1'), scopedAssessment('a2')],
      // 2. métricas globales (per-alumno)
      [{ studentsEvaluated: 30 }],
      // 3. resultAssessmentIds (assessment con datos per-alumno + cuántos con %)
      [{ assessmentId: 'a1' }, { assessmentId: 'a2' }],
      // 4. loadCohortAchievementByAssessment — a1/a2 también en read-model (computed),
      //    ya contados per-alumno → no aportan N ni logro extra.
      [
        { assessmentId: 'a1', scoreSum: '0', maxSum: '0', studentsAssessed: 0 },
        { assessmentId: 'a2', scoreSum: '0', maxSum: '0', studentsAssessed: 0 },
      ],
      // 5. computePerformanceDistribution: filas por resultado { instrumentId, percentage }.
      //    instrumentId null → sin bandas efectivas → corte legacy. 18 en adequate
      //    (75%) + 12 en elementary (50%) = 30 → 60% adequate.
      [
        ...Array.from({ length: 18 }, () => ({ instrumentId: null, percentage: '75.00' })),
        ...Array.from({ length: 12 }, () => ({ instrumentId: null, percentage: '50.00' })),
      ],
      // 6. computePerformanceDistribution → resolveThresholds → resolveApplicableScale
      [],
      // 7. loadRecentAssessments → resolveScopedAssessments
      [scopedAssessment('a1'), scopedAssessment('a2')],
      // 8. loadRecentAssessments → assessments
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
      // 9. loadRecentAssessments → stats
      [{ assessmentId: 'a1', studentsCount: 30, avgPct: '72.50' }],
      // 10. loadRecentAssessments → cohorte (fallback para agregadas; acá no aplica)
      [],
    ]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser({ activeRole: 'academic_director' }), {});

    expect(res.scope).toBe('org');
    // Dos evaluaciones del MISMO instrumento → alcance agregable, así que la
    // distribución sí se emite. Ya no hay "% de logro global" que assertar (#1C).
    expect(res.comparability.kind).toBe('single_instrument');
    expect(res.comparability.aggregatable).toBe(true);
    expect(res.studentsEvaluated).toBe(30);
    expect(res.assessmentsCount).toBe(2);
    // Distribución cubre los 4 niveles, ordenada por PERFORMANCE_LEVELS.
    expect(res.performanceDistribution).toHaveLength(4);
    const adequate = res.performanceDistribution!.find((b) => b.level === 'adequate')!;
    expect(adequate.count).toBe(18);
    expect(adequate.percentage).toBeCloseTo(60);
    expect(res.recentAssessments).toHaveLength(1);
    expect(res.recentAssessments[0]!.instrumentName).toBe('DIA 2025 Lectura');
    expect(res.recentAssessments[0]!.studentsCount).toBe(30);
    // `total` cuenta las evaluaciones del alcance. Ya no hay recorte: la lista
    // devuelve todas las filas que trae la query (acá el mock provee una).
    expect(res.recentAssessmentsTotal).toBe(2);
    // Las alertas ya no salen de acá: nacen de una unidad comparable y viven en
    // `/dashboards/comparable-overview` (#1C — un umbral 60/50 sobre instrumentos
    // mezclados no significaba nada).
  });

  // La distribución por nivel se arma clasificando el `percentage` de cada resultado
  // con las bandas EFECTIVAS de su instrumento, NO con la columna legacy
  // `performance_level`. Con bandas I/II/III (cortes 0/0.5/0.8), un 60% cae en la
  // banda media → 'adequate' (el corte legacy lo habría marcado 'elementary').
  it('distribución: clasifica el % de cada resultado con las bandas de su instrumento', async () => {
    const db = makeDb([
      // 1. resolveScopedAssessments (un solo instrumento → agregable)
      [scopedAssessment('a1')],
      // 2. métricas
      [{ studentsEvaluated: 4 }],
      // 3. resultAssessmentIds
      [{ assessmentId: 'a1' }],
      // 4. cohorte
      [],
      // 5. computePerformanceDistribution: filas por resultado { instrumentId, percentage }
      [
        { instrumentId: 'i1', percentage: '60.00' }, // banda II → adequate
        { instrumentId: 'i1', percentage: '65.00' }, // banda II → adequate
        { instrumentId: 'i1', percentage: '90.00' }, // banda III → advanced
        { instrumentId: 'i1', percentage: '30.00' }, // banda I → insufficient
      ],
      // 6. resolveEffectiveBandsForInstruments → loadFamilyRows
      [familyRow('i1')],
      // 7. resolveEffectiveBandsForInstruments → loadBandsForInstruments (I/II/III propias)
      diaThreeBands('i1'),
      // 8. computePerformanceDistribution → resolveThresholds → resolveApplicableScale
      [],
      // 9. loadRecentAssessments → resolveScopedAssessments
      [scopedAssessment('a1')],
      // 10. loadRecentAssessments → assessments (vacío → lista vacía)
      [],
    ]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser({ activeRole: 'academic_director' }), {});

    expect(res.performanceDistribution).toHaveLength(4);
    const byLevel = new Map(res.performanceDistribution!.map((b) => [b.level, b.count]));
    // 2 en adequate (60% y 65% por la banda media), 1 advanced, 1 insufficient.
    expect(byLevel.get('adequate')).toBe(2);
    expect(byLevel.get('advanced')).toBe(1);
    expect(byLevel.get('insufficient')).toBe(1);
    expect(byLevel.get('elementary')).toBe(0); // ninguno cayó en el bucket legacy
    const adequate = res.performanceDistribution!.find((b) => b.level === 'adequate')!;
    expect(adequate.percentage).toBeCloseTo(50); // 2 de 4
  });

  // Espeja el fallback de `listAssessments`: una evaluación cargada desde un informe
  // oficial no tiene filas por alumno, y la tarjeta mostraba "0 alumnos" y logro "—".
  it('evaluación reciente agregada: N y logro de la fila salen del read-model de cohorte', async () => {
    const db = makeDb([
      [scopedAssessment('a1')], // resolveScopedAssessments
      [{ studentsEvaluated: 0 }], // métricas per-alumno
      [], // resultAssessmentIds
      [{ assessmentId: 'a1', scoreSum: '820', maxSum: '2000', studentsAssessed: 41 }], // read-model
      [], // distribución
      [scopedAssessment('a1')], // loadRecentAssessments → resolveScopedAssessments
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

  it('sin evaluaciones que matcheen → total en 0 (no queda un total viejo colgando)', async () => {
    const db = makeDb([[]]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser(), { applicationPeriod: ['intermedio'] });

    expect(res.recentAssessments).toEqual([]);
    expect(res.recentAssessmentsTotal).toBe(0);
  });

  it('sin evaluaciones que matcheen → overview vacío con distribución de ceros', async () => {
    const db = makeDb([
      // resolveScopedAssessments → vacío
      [],
    ]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser({ activeRole: 'school_admin' }), {});
    expect(res.assessmentsCount).toBe(0);
    expect(res.performanceDistribution).toBeNull();
    expect(res.comparability.kind).toBe('empty');
    expect(res.studentsEvaluated).toBe(0);
    expect(res.recentAssessments).toEqual([]);
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

  // Regresión: la lista estaba recortada a `.limit(5)`. Con más evaluaciones en el
  // alcance, las filas visibles no podían explicar el KPI global (que agrega sobre
  // TODAS) y la diferencia se leía como un error de cálculo.
  it('la lista de evaluaciones NO se trunca: devuelve todas las del alcance', async () => {
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];
    const assessmentRow = (id: string) => ({
      assessmentId: id,
      name: `Eval ${id}`,
      administeredAt: new Date('2025-03-01'),
      createdAt: new Date('2025-03-01'),
      status: 'completed',
      instrumentName: 'DIA',
      instrumentType: 'dia',
      subjectName: 'Matemática',
      gradeName: '5° Básico',
    });
    const db = makeDb([
      ids.map((id) => scopedAssessment(id)), // 1. resolveScopedAssessments
      [{ studentsEvaluated: 80 }], // 2. métricas
      ids.map((id) => ({ assessmentId: id })), // 3. resultAssessmentIds
      [], // 4. cohorte
      [], // 5. distribución
      ids.map((id) => ({ id })), // 6. recientes → scoped ids
      ids.map(assessmentRow), // 7. recientes → assessments
      [], // 8. stats
      [], // 9. cohorte
    ]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser({ activeRole: 'academic_director' }), {});

    expect(res.recentAssessments).toHaveLength(8); // antes: 5
    expect(res.recentAssessmentsTotal).toBe(8);
  });

  // Regresión: el fallback al read-model era todo-o-nada. Un informe agregado con
  // filas por alumno de sólo-nivel (percentage NULL) tenía `stats`, así que nunca
  // caía al cohorte y mostraba logro "—" teniendo el dato.
  it('lista: una agregada con filas sin porcentaje toma el logro del read-model', async () => {
    const db = makeDb([
      [scopedAssessment('a1')], // 1. resolveScopedAssessments
      [{ studentsEvaluated: 30 }], // 2. métricas
      [{ assessmentId: 'a1' }], // 3. tiene filas, ningún porcentaje
      [{ assessmentId: 'a1', scoreSum: '90', maxSum: '200', studentsAssessed: 30 }], // 4. cohorte
      [], // 5. distribución
      [scopedAssessment('a1')], // 6. recientes → scoped ids
      [
        {
          assessmentId: 'a1',
          name: 'MATH cierre 2025',
          administeredAt: new Date('2025-11-01'),
          createdAt: new Date('2025-11-01'),
          status: 'completed',
          instrumentName: 'DIA Matemática',
          instrumentType: 'dia',
          subjectName: 'Matemática',
          gradeName: '5° Básico',
        },
      ], // 7. recientes → assessments
      // 8. stats per-alumno: hay alumnos con fila, pero el avg es NULL.
      [{ assessmentId: 'a1', studentsCount: 30, avgPct: null }],
      // 9. cohorte de la lista: 90/200 = 45%
      [{ assessmentId: 'a1', scoreSum: '90', maxSum: '200', studentsAssessed: 30 }],
    ]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser({ activeRole: 'academic_director' }), {});

    const row = res.recentAssessments[0]!;
    expect(row.studentsCount).toBe(30);
    expect(row.averageAchievement).toBeCloseTo(45, 6); // antes: null → "—"
    // El logro vive en la fila de la evaluación, que ES una unidad comparable. No
    // hay promedio de portada que lo repita mezclado con otras evaluaciones (#1C).
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
      // 1. resolveScopedAssessments → el assessment agregado sí existe en `assessments`
      [scopedAssessment('a1')],
      // 2. métricas per-alumno → sin resultados (informe agregado)
      [{ studentsEvaluated: 0 }],
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
  });

  it('org mixta (item_level + agregado): cuenta ambos sin doble-contar', async () => {
    const db = makeDb([
      // 1. resolveScopedAssessments → a1 (item_level) + a2 (agregado)
      [scopedAssessment('a1'), scopedAssessment('a2')],
      // 2. métricas per-alumno de a1: 80% sobre 20 alumnos
      [{ studentsEvaluated: 20 }],
      // 3. resultAssessmentIds → sólo a1 tiene datos per-alumno (con porcentaje)
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
  });

  // Regresión: un informe oficial cargado en modo agregado puede crear filas por
  // alumno que sólo traen el nivel de desempeño (`performance_band_id`) con
  // `percentage` NULL. Antes esas filas marcaban la evaluación como "ya contada por
  // alumno", así que se saltaba la rama de cohorte, y el `avg` la ignoraba por NULL:
  // su logro desaparecía del KPI sin ningún error. En la org demo eran 24 de 40.
  it('agregado con filas de SÓLO nivel (percentage NULL): su logro entra por cohorte', async () => {
    const db = makeDb([
      // 1. resolveScopedAssessments → a1 (item_level) + a2 (agregado con filas de nivel)
      [scopedAssessment('a1'), scopedAssessment('a2')],
      // 2. métricas per-alumno: sólo a1 aporta porcentaje (80% sobre 20 alumnos).
      //    Los 30 alumnos de a2 tienen fila (cuentan como evaluados) pero su
      //    `percentage` es NULL, así que no pesan en el promedio.
      [{ studentsEvaluated: 50 }],
      // 3. a1 con 20 porcentajes; a2 con filas pero NINGÚN porcentaje.
      [{ assessmentId: 'a1' }, { assessmentId: 'a2' }],
      // 4. read-model: a1 (ya cubierto per-alumno) + a2 (90/200 = 45%, N 30)
      [
        { assessmentId: 'a1', scoreSum: '160', maxSum: '200', studentsAssessed: 20 },
        { assessmentId: 'a2', scoreSum: '90', maxSum: '200', studentsAssessed: 30 },
      ],
    ]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser({ activeRole: 'academic_director' }), {});

    expect(res.assessmentsCount).toBe(2);
    // Los alumnos de a2 YA están en el count(distinct) per-alumno (tienen fila): no
    // se vuelven a sumar desde el read-model.
    expect(res.studentsEvaluated).toBe(50);
  });

  // ── #1C: alcance NO comparable ────────────────────────────────────────────
  // El corazón del cambio: con instrumentos que no se pueden comparar, el overview
  // sigue entregando los CONTEOS (no promedian nada) pero NO la distribución por
  // nivel, que mezclaría los cortes de cada instrumento.
  it('alcance mixto: emite conteos pero NO distribución, y explica por qué', async () => {
    const db = makeDb([
      // 1. dos instrumentos de asignaturas distintas → no comparables
      [
        scopedAssessment('a1', 'i1', { instrumentSubjectId: 's-leng' }),
        scopedAssessment('a2', 'i2', { instrumentSubjectId: 's-mate' }),
      ],
      // 2. métricas per-alumno
      [{ studentsEvaluated: 40 }],
      // 3. resultAssessmentIds
      [{ assessmentId: 'a1' }, { assessmentId: 'a2' }],
      // 4. cohorte
      [],
    ]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser({ activeRole: 'academic_director' }), {});

    expect(res.comparability.kind).toBe('mixed');
    expect(res.comparability.aggregatable).toBe(false);
    expect(res.comparability.reason).toContain('2 instrumentos');
    // Los conteos SÍ: son sumas, no promedios.
    expect(res.assessmentsCount).toBe(2);
    expect(res.studentsEvaluated).toBe(40);
    // La distribución NO.
    expect(res.performanceDistribution).toBeNull();
  });

  it('mismo instrumento en dos años es comparable, pero tampoco agregable', async () => {
    const db = makeDb([
      [
        scopedAssessment('a1', 'i1', { instrumentYear: 2026 }),
        scopedAssessment('a2', 'i2', { instrumentYear: 2025 }),
      ],
      [{ studentsEvaluated: 40 }],
      [{ assessmentId: 'a1' }, { assessmentId: 'a2' }],
      [],
    ]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser({ activeRole: 'academic_director' }), {});

    expect(res.comparability.kind).toBe('instrument_family');
    expect(res.comparability.aggregatable).toBe(false);
    expect(res.comparability.familyKey).not.toBeNull();
    expect(res.performanceDistribution).toBeNull();
  });

  it('org item_level puro sin read-model: los conteos no dependen del read-model', async () => {
    const db = makeDb([
      // 1. resolveScopedAssessments
      [scopedAssessment('a1')],
      // 2. métricas per-alumno: 70% sobre 15 alumnos
      [{ studentsEvaluated: 15 }],
      // 3. resultAssessmentIds → a1
      [{ assessmentId: 'a1' }],
      // 4. read-model vacío (datos antiguos previos al backfill)
      [],
    ]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser({ activeRole: 'school_admin' }), {});
    expect(res.assessmentsCount).toBe(1);
    expect(res.studentsEvaluated).toBe(15);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Alcance por año académico / curso
//
// El año y el curso viven en `class_groups`, no en el instrumento: sin cruzar los
// assessments contra los cursos del alcance, filtrar por 2026 seguía trayendo las
// evaluaciones de 2025 del mismo instrumento-hermano (misma asignatura y nivel).
// ──────────────────────────────────────────────────────────────────────────────

describe('DashboardsService — alcance por año académico', () => {
  const YEAR_QUERY = { academicYearId: 'ay-2026' };

  it('filtrar por año acota las evaluaciones a los cursos de ese año', async () => {
    const db = makeDb([
      // 1. resolveScopedStudentIds (hay filtro de año → consulta)
      [{ studentId: 's1' }],
      // 2. resolveScopedClassGroupIds → cursos del 2026
      [{ id: 'cg-2026-a' }, { id: 'cg-2026-b' }],
      // 3. resolveScopedAssessments
      [scopedAssessment('a-2026')],
      // 4. métricas per-alumno
      [{ studentsEvaluated: 40 }],
      // 5. resultAssessmentIds
      [{ assessmentId: 'a-2026' }],
      // 6. read-model de cohorte
      [],
    ]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser({ activeRole: 'school_admin' }), YEAR_QUERY);

    const assessmentsWhere = db.__whereSql(3);
    expect(assessmentsWhere).toContain('"assessment_course_assignments"');
    expect(assessmentsWhere).toContain('"class_group_id" in');
    expect(res.assessmentsCount).toBe(1);
  });

  it('una evaluación sin cursos asignados sigue visible (no se puede ubicar en un año)', async () => {
    const db = makeDb([
      [{ studentId: 's1' }],
      [{ id: 'cg-2026-a' }],
      [scopedAssessment('a-sin-curso')],
      [{ studentsEvaluated: 10 }],
      [{ assessmentId: 'a-sin-curso' }],
      [],
    ]);
    const svc = makeService(db);
    await svc.getOverview(makeUser({ activeRole: 'school_admin' }), YEAR_QUERY);

    expect(db.__whereSql(3)).toContain('not exists');
  });

  it('un año sin cursos no consulta evaluaciones: alcance vacío', async () => {
    const db = makeDb([
      // 1. resolveScopedStudentIds → hay alumnos (matriculados en otros años)
      [{ studentId: 's1' }],
      // 2. resolveScopedClassGroupIds → el año pedido no tiene cursos
      [],
    ]);
    const svc = makeService(db);
    const res = await svc.getOverview(makeUser({ activeRole: 'school_admin' }), YEAR_QUERY);

    expect(res.assessmentsCount).toBe(0);
    expect(db.__selectIdx()).toBe(2);
  });

  it('el panorama comparable hereda el mismo alcance por curso', async () => {
    const db = makeDb([
      // 1. resolveScopedClassGroupIds
      [{ id: 'cg-2026-a' }],
      // 2. resolveScopedAssessments
      [scopedAssessment('a-2026')],
    ]);
    const svc = makeService(db);
    const scope = await svc.resolveScopeForComparableOverview(
      makeUser({ activeRole: 'school_admin' }),
      YEAR_QUERY,
    );

    expect(scope?.assessmentIds).toEqual(['a-2026']);
    expect(db.__whereSql(2)).toContain('"assessment_course_assignments"');
  });

  it('sin filtro de año ni de curso el alcance no se restringe por curso', async () => {
    const db = makeDb([
      // 1. resolveScopedAssessments (resolveScopedClassGroupIds retorna null sin consultar)
      [scopedAssessment('a1')],
      [{ studentsEvaluated: 30 }],
      [{ assessmentId: 'a1' }],
      [],
    ]);
    const svc = makeService(db);
    await svc.getOverview(makeUser({ activeRole: 'school_admin' }), {});

    expect(db.__whereSql(1)).not.toContain('"assessment_course_assignments"');
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
      // 6. scopedCgRows (cursos accesibles sin filtro de año)
      [{ id: 'cg1' }],
      // 7. periodRows (momentos con evaluaciones en el alcance)
      [],
      // 8. dataInstrumentRows (instrumentos con datos — P3)
      [{ instrumentId: 'i1' }],
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

  // P3 — el selector de instrumento sólo lista los que tienen datos en el alcance.
  it('filtra del selector los instrumentos sin datos', async () => {
    const db = makeDb([
      [{ academicYearId: 'ay1', year: 2025, isCurrent: true }],
      [{ id: 'cg1', name: '2°A', gradeId: 'g1', academicYearId: 'ay1', gradeName: '2° Básico' }],
      [{ id: 'sub1', name: 'Lenguaje' }],
      [
        { id: 'i1', name: 'DIA con datos', type: 'dia', subjectId: 'sub1', gradeId: 'g1' },
        { id: 'i2', name: 'DIA sin datos', type: 'dia', subjectId: 'sub1', gradeId: 'g1' },
      ],
      [{ id: 'ay1', year: 2025, isCurrent: true }],
      [{ id: 'cg1' }],
      [],
      // dataInstrumentRows: sólo i1 tiene read-model de cohorte en el alcance
      [{ instrumentId: 'i1' }],
    ]);
    const svc = makeService(db);
    const res = await svc.getFilterOptions(makeUser({ activeRole: 'school_admin' }), {});
    expect(res.instruments.map((i) => i.id)).toEqual(['i1']);
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
      // 1. resolveScopedAssessments
      [scopedAssessment('a1')],
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
      // resolveScopedAssessments
      [scopedAssessment('a1')],
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
      // resolveScopedAssessments → vacío
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
    expect(res.distribution).toBeNull();
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
      // 1. resolveScopedAssessments
      [scopedAssessment('a1')],
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
      [scopedAssessment('a1')],
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
      [scopedAssessment('a1'), scopedAssessment('a2')],
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
      [scopedAssessment('a1')],
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
      // 2. resolveScopedAssessments
      [scopedAssessment('a1')],
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
      // 3. resolveScopedAssessments
      [scopedAssessment('a1')],
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
      // 2. resolveScopedAssessments
      [scopedAssessment('a1')],
      // 3. resolveThresholds → resolveApplicableScale (sin escala → defaults)
      [],
      // 4. resolveScopedBands: >1 instrumento en scope → sin bandas (corte legacy)
      [{ instrumentId: 'i1' }, { instrumentId: 'i2' }],
      // 5. breakdown por classGroup sobre assessment_skill_stats
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
      [scopedAssessment('a1')],
      [],
      // resolveScopedBands: >1 instrumento → sin bandas (corte legacy)
      [{ instrumentId: 'i1' }, { instrumentId: 'i2' }],
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

  // Con un único instrumento con bandas propias, el nivel de cada fila sale de las
  // bandas del instrumento (I/II/III proyectadas a los 4 niveles), NO del corte legacy.
  it('clasifica cada fila por las bandas del instrumento cuando el scope es uno solo', async () => {
    const db = makeDb([
      // 1. metadata del nodo
      [{ name: 'Localizar información', type: 'skill', code: 'OA1' }],
      // 2. resolveScopedAssessments
      [scopedAssessment('a1')],
      // 3. resolveThresholds → resolveApplicableScale
      [],
      // 4. resolveScopedBands → selectDistinct instrumento (uno solo)
      [{ instrumentId: 'i1' }],
      // 5. resolveEffectiveBands → loadFamilyRows
      [familyRow('i1')],
      // 6. resolveEffectiveBands → loadBandsForInstruments (bandas propias I/II/III)
      diaThreeBands('i1'),
      // 7. breakdown por classGroup
      [
        {
          id: 'cg1',
          name: '2°A',
          gradeName: '2° Básico',
          pctSum: '1200.00', // 60% × 20 → banda media (order 1) → adequate
          pctWeight: 20,
          studentsAssessed: 20,
        },
        {
          id: 'cg2',
          name: '2°B',
          gradeName: '2° Básico',
          pctSum: '600.00', // 30% × 20 → banda inferior (order 0) → insufficient
          pctWeight: 20,
          studentsAssessed: 20,
        },
      ],
    ]);
    const svc = makeService(db);
    const res = await svc.getSkillBreakdown(makeUser({ activeRole: 'academic_director' }), {
      nodeId: 'n1',
      groupBy: 'classGroup',
    });
    // 60% con el corte legacy sería 'elementary'; por las bandas del instrumento
    // (order 1 de 3) es 'adequate'.
    expect(res.rows[0]!.averageAchievement).toBe(60);
    expect(res.rows[0]!.performanceLevel).toBe('adequate');
    // 30% cae en la banda inferior → 'insufficient' (igual que el legacy acá, pero
    // decidido por las bandas).
    expect(res.rows[1]!.performanceLevel).toBe('insufficient');
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
      // 3. resolvePassingGrade → resolveScopedAssessments
      [scopedAssessment('a1')],
      // 4. resolvePassingGrade → resolveApplicableScale (null → default 4.0)
      [],
      // 5. resolveScopedAssessments (segunda llamada, en getTeacherKpis)
      [scopedAssessment('a1')],
      // 6. studentRows del curso
      [{ studentId: 's1' }, { studentId: 's2' }],
      // 7. agg por curso × INSTRUMENTO
      [
        {
          instrumentId: 'i1',
          instrumentName: 'DIA Lectura 2°',
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
    expect(c.instrumentName).toBe('DIA Lectura 2°');
    expect(c.studentsCount).toBe(2);
    expect(c.averageAchievement).toBe(65);
    expect(c.passingRate).toBe(50); // 1 de 2 resultados aprobados
    expect(c.criticalStudents).toBe(1);
    expect(c.assessmentsCount).toBe(1);
  });

  // ── #1C / D5: el grano es curso × instrumento ──────────────────────────────
  // Antes, un curso con dos instrumentos de dificultad distinta salía como UNA fila
  // con el promedio de ambos — un número que no se puede leer.
  it('un curso con dos instrumentos produce DOS filas, no un promedio mezclado', async () => {
    const db = makeDb([
      // 1. courseRows
      [{ classGroupId: 'cg1', classGroupName: '8°B', gradeName: '8° Básico' }],
      // 2. loadSubjectNamesByClassGroup
      [],
      // 3. resolvePassingGrade → resolveScopedAssessments
      [scopedAssessment('a1')],
      // 4. resolvePassingGrade → resolveApplicableScale
      [],
      // 5. resolveScopedAssessments (segunda llamada)
      [scopedAssessment('a1')],
      // 6. studentRows del curso
      [{ studentId: 's1' }, { studentId: 's2' }],
      // 7. agg por curso × instrumento: dos instrumentos distintos
      [
        {
          instrumentId: 'i1',
          instrumentName: 'DIA Lectura 8°',
          avgPct: '80.00',
          assessmentsCount: 1,
          totalResults: 2,
          passingResults: 2,
          criticalStudents: 0,
        },
        {
          instrumentId: 'i2',
          instrumentName: 'DIA Matemática 8°',
          avgPct: '40.00',
          assessmentsCount: 1,
          totalResults: 2,
          passingResults: 0,
          criticalStudents: 2,
        },
      ],
    ]);
    const svc = makeService(db);
    const res = await svc.getTeacherKpis(makeUser({ activeRole: 'academic_director' }), {});

    expect(res.courses).toHaveLength(2);
    // Cada fila conserva el logro DE SU instrumento; en ningún lado aparece el 60 que
    // habría dado promediarlos.
    expect(res.courses.map((c) => c.averageAchievement)).toEqual([80, 40]);
    expect(res.courses.map((c) => c.instrumentName)).toEqual([
      'DIA Lectura 8°',
      'DIA Matemática 8°',
    ]);
    // Ambas filas son del mismo curso, con el mismo N de alumnos.
    expect(res.courses.every((c) => c.classGroupId === 'cg1')).toBe(true);
    expect(res.courses.every((c) => c.studentsCount === 2)).toBe(true);
  });

  it('curso sin evaluaciones → métricas en null/0 pero la fila existe', async () => {
    const db = makeDb([
      // courseRows
      [{ classGroupId: 'cg1', classGroupName: '2°A', gradeName: '2° Básico' }],
      // loadSubjectNamesByClassGroup
      [],
      // resolvePassingGrade → resolveScopedAssessments (vacío)
      [],
      // resolveApplicableScale no se consulta (assessmentIds vacío)
      // resolveScopedAssessments (segunda) → vacío
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
