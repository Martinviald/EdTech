import type { Database } from '@soe/db';
import type { UserRole } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { AssessmentReportService } from './assessment-report.service';

// ──────────────────────────────────────────────────────────────────────────────
// Mock de Database: cada `select()` consume la siguiente respuesta de
// `selectResults` en orden. Builder encadenable que resuelve a un array al hacer
// `await`. Mismo estilo que analytics.service.spec.ts.
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

// Mock estándar: getReport corre dentro de withOrgContext(db, orgId, fn) =
// db.transaction(tx => { tx.execute(set_config); fn(tx) }). El mock ejecuta fn
// con el mismo `db` (mismo selectIdx) y `execute` es no-op.
function makeDb(selectResults: unknown[][]): Database {
  let selectIdx = 0;
  const db = {
    select: () => {
      const rows = selectResults[selectIdx] ?? [];
      selectIdx++;
      return buildSelectChain(rows);
    },
    execute: async () => undefined,
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  } as unknown as Database;
  return db;
}

// Mock que simula RLS (§5.2): las queries en `this.db` (SIN contexto de org)
// devuelven SIEMPRE 0 filas, como haría PostgreSQL bajo un rol sin BYPASSRLS.
// Sólo dentro de `transaction` (el `tx` de withOrgContext, con app.current_org_id
// fijado) las queries ven las filas precargadas. Si algún día getReport dejara de
// envolver en withOrgContext, requireAssessment leería de `this.db` → [] →
// NotFound, y el test de regresión abajo fallaría.
function makeRlsAwareDb(selectResults: unknown[][]): Database {
  let selectIdx = 0;
  const tx = {
    select: () => {
      const rows = selectResults[selectIdx] ?? [];
      selectIdx++;
      return buildSelectChain(rows);
    },
    execute: async () => undefined,
  };
  const db = {
    select: () => buildSelectChain([]), // RLS sin contexto → 0 filas
    execute: async () => undefined,
    transaction: async (fn: (t: unknown) => unknown) => fn(tx),
  } as unknown as Database;
  return db;
}

function makeService(db: Database): AssessmentReportService {
  return new (AssessmentReportService as new (db: Database) => AssessmentReportService)(db);
}

const ASSESSMENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// Escenario base: 4 alumnos evaluados, 2 ítems, 2 cursos. gradingScaleId null →
// SIN escala configurada (TKT-04): los campos de nota vienen null, sin query extra.
function baseSelectResults(): unknown[][] {
  return [
    // 0. requireAssessment
    [
      {
        id: ASSESSMENT_ID,
        orgId: 'org-1',
        name: 'DIA Lenguaje',
        instrumentId: 'inst-1',
        instrumentName: 'DIA Lenguaje 3°',
        instrumentType: 'dia',
        subjectName: 'Lenguaje',
        administeredAt: new Date('2026-05-10'),
        dataGranularity: 'item_level',
        gradingScaleId: null,
        gradingScaleConfig: null,
      },
    ],
    // 1. loadAssessmentClassGroups
    [
      { id: 'cg1', name: '3°A', gradeName: '3° Básico' },
      { id: 'cg2', name: '3°B', gradeName: '3° Básico' },
    ],
    // 2. loadItemColumns → items. `alternatives` no es decorativo: es el predicado
    // de `hasAlternatives` (idéntico al del escritor del read-model), y de él depende
    // que los buckets se lean como alternativas marcadas y no como las categorías por
    // puntaje ('RC'|'RPC'|'RI') de un ítem de desarrollo.
    [
      {
        itemId: 'i1',
        position: 1,
        content: {
          correctKey: 'A',
          alternatives: [{ key: 'A' }, { key: 'B' }, { key: 'C' }, { key: 'D' }],
        },
      },
      {
        itemId: 'i2',
        position: 2,
        content: {
          correctKey: 'B',
          alternatives: [{ key: 'A' }, { key: 'B' }, { key: 'C' }, { key: 'D' }],
        },
      },
    ],
    // 3. loadTagsByItems
    [
      { itemId: 'i1', nodeName: 'Localizar información', nodeType: 'skill' },
      { itemId: 'i2', nodeName: 'Interpretar', nodeType: 'skill' },
    ],
    // 4. loadEvaluatedStudents
    [
      {
        studentId: 's1',
        studentRut: '1-9',
        firstName: 'Ana',
        lastName: 'A',
        percentage: '90.00',
        grade: '6.30',
        performanceLevel: 'advanced',
      },
      {
        studentId: 's2',
        studentRut: '2-7',
        firstName: 'Beto',
        lastName: 'B',
        percentage: '75.00',
        grade: '5.00',
        performanceLevel: 'adequate',
      },
      {
        studentId: 's3',
        studentRut: '3-5',
        firstName: 'Caro',
        lastName: 'C',
        percentage: '45.00',
        grade: '3.50',
        performanceLevel: 'elementary',
      },
      {
        studentId: 's4',
        studentRut: '4-3',
        firstName: 'Dani',
        lastName: 'D',
        percentage: '20.00',
        grade: '2.00',
        performanceLevel: 'insufficient',
      },
    ],
    // 5. loadStudentClassGroups
    [
      { studentId: 's1', classGroupId: 'cg1', classGroupName: '3°A' },
      { studentId: 's2', classGroupId: 'cg1', classGroupName: '3°A' },
      { studentId: 's3', classGroupId: 'cg2', classGroupName: '3°B' },
      { studentId: 's4', classGroupId: 'cg2', classGroupName: '3°B' },
    ],
    // 6. countEnrolled
    [{ total: 5 }],
    // 6b. loadInstrumentBands (sin bandas configuradas → modo legacy 4 niveles)
    [],
    // 7. loadItemCohortStats → assessment_item_stats (read-model de cohorte).
    // Una fila por (curso × ítem); acá un solo curso por ítem.
    [
      {
        itemId: 'i1',
        responseCount: 4,
        correctCount: 3,
        answerCounts: [
          { key: 'A', count: 3, isCorrect: true },
          { key: 'B', count: 1, isCorrect: false },
        ],
      },
      {
        itemId: 'i2',
        responseCount: 4,
        correctCount: 1,
        answerCounts: [
          { key: 'B', count: 1, isCorrect: true },
          { key: 'C', count: 3, isCorrect: false },
        ],
      },
    ],
    // 8. loadGroupCorrectness(top = s1)
    [
      { itemId: 'i1', total: 1, correct: 1 },
      { itemId: 'i2', total: 1, correct: 1 },
    ],
    // 9. loadGroupCorrectness(bottom = s4)
    [
      { itemId: 'i1', total: 1, correct: 0 },
      { itemId: 'i2', total: 1, correct: 0 },
    ],
    // 10. buildSkills → assessment_skill_stats, ya agregado en SQL al grano
    // (nodo × curso). `pctSum`/`pctWeight` son el promedio ponderado por
    // studentCount: 120/4 = 30% y 320/4 = 80%, los mismos números que daba el
    // `avg(skill_results.percentage)` que reemplaza.
    [
      {
        nodeId: 'n2',
        nodeName: 'Interpretar',
        nodeType: 'skill',
        nodeCode: null,
        pctSum: '120.00',
        pctWeight: 4,
        studentsAssessed: 4,
      },
      {
        nodeId: 'n1',
        nodeName: 'Localizar información',
        nodeType: 'skill',
        nodeCode: null,
        pctSum: '320.00',
        pctWeight: 4,
        studentsAssessed: 4,
      },
    ],
    // 11. loadWeakestSkillPerStudent (atRisk = s3, s4)
    [
      { studentId: 's4', nodeName: 'Interpretar', percentage: '10.00' },
      { studentId: 's3', nodeName: 'Interpretar', percentage: '20.00' },
    ],
  ];
}

describe('AssessmentReportService.getReport', () => {
  it('sin escala configurada: reporta cobertura/logro/nivel pero anula los campos de nota (TKT-04)', async () => {
    const svc = makeService(makeDb(baseSelectResults()));
    const res = await svc.getReport(makeUser(), { assessmentId: ASSESSMENT_ID });

    expect(res.summary.studentsEvaluated).toBe(4);
    expect(res.summary.studentsEnrolled).toBe(5);
    expect(res.summary.coverageRate).toBeCloseTo(80);
    expect(res.summary.averageAchievement).toBeCloseTo(57.5);
    // TKT-04 — instrumento sin grading scale: no se inventa el corte 4.0.
    expect(res.summary.hasGradingScale).toBe(false);
    expect(res.summary.averageGrade).toBeNull();
    expect(res.summary.passingGrade).toBeNull();
    expect(res.summary.passingRate).toBeNull();
    // El % de logro y el nivel de desempeño NO dependen de la escala de notas.
    expect(res.summary.performanceLevel).toBe('elementary'); // 57.5% → elemental
    expect(res.meta.itemsCount).toBe(2);
    // Sin escala, la comparativa por curso tampoco reporta tasa de aprobación.
    expect(res.courseComparison.every((c) => c.passingRate === null)).toBe(true);
  });

  it('con escala configurada: reporta nota promedio, corte y tasa de aprobación (TKT-04)', async () => {
    const results = baseSelectResults();
    (results[0][0] as Record<string, unknown>).gradingScaleId = 'gs-1';
    // resolvePassingGrade hace 1 select extra justo después de requireAssessment.
    results.splice(1, 0, [{ passingGrade: '4.0' }]);

    const svc = makeService(makeDb(results));
    const res = await svc.getReport(makeUser(), { assessmentId: ASSESSMENT_ID });

    expect(res.summary.hasGradingScale).toBe(true);
    expect(res.summary.averageGrade).toBeCloseTo(4.2);
    expect(res.summary.passingGrade).toBe(4.0);
    expect(res.summary.passingRate).toBeCloseTo(50); // 6.30 y 5.00 aprueban
  });

  it('distribuye los niveles y ordena la comparativa por curso con su brecha', async () => {
    const svc = makeService(makeDb(baseSelectResults()));
    const res = await svc.getReport(makeUser(), { assessmentId: ASSESSMENT_ID });

    const dist = Object.fromEntries(res.distribution.map((b) => [b.level, b.count]));
    expect(dist).toEqual({
      insufficient: 1,
      elementary: 1,
      adequate: 1,
      advanced: 1,
    });

    // 3°A (82.5%) por delante de 3°B (32.5%); brechas simétricas vs 57.5%.
    expect(res.courseComparison.map((c) => c.classGroupName)).toEqual(['3°A', '3°B']);
    const [a, b] = res.courseComparison;
    expect(a.averageAchievement).toBeCloseTo(82.5);
    expect(a.gapVsAverage).toBeCloseTo(25);
    expect(a.criticalStudents).toBe(0);
    expect(b.averageAchievement).toBeCloseTo(32.5);
    expect(b.gapVsAverage).toBeCloseTo(-25);
    expect(b.criticalStudents).toBe(2); // elemental + insuficiente
  });

  it('calcula dificultad, discriminación y flags psicométricos por ítem', async () => {
    const svc = makeService(makeDb(baseSelectResults()));
    const res = await svc.getReport(makeUser(), { assessmentId: ASSESSMENT_ID });

    const i1 = res.items.find((i) => i.position === 1)!;
    const i2 = res.items.find((i) => i.position === 2)!;

    // i1: 3/4 aciertos → p=75%, discrimina perfecto (D=1), sin alertas.
    expect(i1.difficulty).toBeCloseTo(75);
    expect(i1.discrimination).toBeCloseTo(1);
    expect(i1.flags).toEqual([]);

    // i2: 1/4 aciertos → p=25% (crítico) y el distractor C (3) supera a la clave (1).
    expect(i2.difficulty).toBeCloseTo(25);
    expect(i2.topDistractorKey).toBe('C');
    expect(i2.flags).toContain('critical');
    expect(i2.flags).toContain('strong_distractor');
  });

  it('ordena habilidades por brecha y deriva fortalezas/brechas y alumnos en foco', async () => {
    const svc = makeService(makeDb(baseSelectResults()));
    const res = await svc.getReport(makeUser(), { assessmentId: ASSESSMENT_ID });

    // skills asc por logro: Interpretar (30%) antes que Localizar (80%).
    expect(res.skills[0].nodeName).toBe('Interpretar');
    expect(res.highlights.gaps[0]).toBe('Interpretar');
    expect(res.highlights.strengths[0]).toBe('Localizar información');

    // Alumnos en foco: s4 (20%) y s3 (45%), peor primero, con su habilidad débil.
    expect(res.studentsAtRisk.map((s) => s.studentFullName)).toEqual(['Dani D', 'Caro C']);
    expect(res.studentsAtRisk[0].weakestSkill).toBe('Interpretar');

    // Recomendaciones: reforzar habilidad en brecha + apoyo a alumnos en riesgo.
    const types = res.recommendations.map((r) => r.type);
    expect(types).toContain('reteach_skill');
    expect(types).toContain('support_students');
  });

  // §9.5 del plan: en el importador `students` es OPCIONAL (para no atar cada carga
  // al OCR de la Figura 1), así que una evaluación puede tener el read-model de
  // cohorte poblado y CERO niveles por alumno. La capa agregable no depende de
  // `assessment_results`: si se calculara después del corte por "sin alumnos
  // evaluados", el informe saldría en ceros teniendo los datos en la mano.
  it('sin alumnos evaluados sigue reportando la capa agregable (ítems y habilidades)', async () => {
    const results = baseSelectResults();
    results[4] = []; // loadEvaluatedStudents sin filas
    results.splice(5, 1); // loadStudentClassGroups no consulta con 0 alumnos
    results.splice(8, 2); // sin percentages no hay grupos 27/27 → no consulta

    const svc = makeService(makeDb(results));
    const res = await svc.getReport(makeUser(), { assessmentId: ASSESSMENT_ID });

    expect(res.summary.studentsEvaluated).toBe(0);
    expect(res.summary.averageAchievement).toBeNull();
    expect(res.courseComparison).toEqual([]);
    expect(res.studentsAtRisk).toEqual([]);

    // Lo agregable viene completo desde el read-model, no en cero.
    expect(res.items).toHaveLength(2);
    expect(res.items[0].difficulty).toBeCloseTo(75);
    // …salvo la discriminación, que necesita el puntaje de cada alumno.
    expect(res.items[0].discrimination).toBeNull();
    expect(res.items[0].flags).not.toContain('low_discrimination');
    expect(res.skills.map((s) => s.nodeName)).toEqual(['Interpretar', 'Localizar información']);
  });

  // ── Datos agregados (informe oficial DIA) ───────────────────────────────────
  // El agujero que cierran estos tests: `meta.capabilities` declaraba que
  // `cohort_item_stats` y `cohort_skill_stats` funcionaban mientras el propio
  // informe seguía leyendo `responses` y `skill_results` → una evaluación
  // `aggregate_only` renderizaba CEROS en el mismo endpoint que prometía lo
  // contrario.

  // 3 bandas (I/II/III). bandToLegacyLevel reparte por posición: I → insufficient,
  // II → adequate, III → advanced.
  const DIA_BANDS = [
    {
      id: 'b1',
      orgId: null,
      key: 'I',
      label: 'Nivel I',
      order: 1,
      minThreshold: '0.00',
      maxThreshold: '0.50',
      color: null,
    },
    {
      id: 'b2',
      orgId: null,
      key: 'II',
      label: 'Nivel II',
      order: 2,
      minThreshold: '0.50',
      maxThreshold: '0.80',
      color: null,
    },
    {
      id: 'b3',
      orgId: null,
      key: 'III',
      label: 'Nivel III',
      order: 3,
      minThreshold: '0.80',
      maxThreshold: '1.00',
      color: null,
    },
  ];

  // Como el importador (§6.3): `metric_type='band'` con `performance_band_id`, y
  // `percentage`/`grade`/`performance_level` en NULL — el informe oficial entrega el
  // NIVEL de cada alumno, no su porcentaje.
  function aggregateSelectResults(): unknown[][] {
    const results = baseSelectResults();
    (results[0][0] as Record<string, unknown>).dataGranularity = 'aggregate_only';
    results[4] = [
      {
        studentId: 's1',
        studentRut: '1-9',
        firstName: 'Ana',
        lastName: 'A',
        percentage: null,
        grade: null,
        performanceLevel: null,
        performanceBandId: 'b3',
      },
      {
        studentId: 's2',
        studentRut: '2-7',
        firstName: 'Beto',
        lastName: 'B',
        percentage: null,
        grade: null,
        performanceLevel: null,
        performanceBandId: 'b1',
      },
    ];
    results[5] = [
      { studentId: 's1', classGroupId: 'cg1', classGroupName: '3°A' },
      { studentId: 's2', classGroupId: 'cg1', classGroupName: '3°A' },
    ];
    results[7] = DIA_BANDS; // loadInstrumentBands
    results.splice(9, 2); // sin percentages no hay grupos 27/27 → no consulta
    return results;
  }

  it('con datos agregados sirve ítems y habilidades desde el read-model, y anula sólo lo irreducible', async () => {
    const svc = makeService(makeDb(aggregateSelectResults()));
    const res = await svc.getReport(makeUser(), { assessmentId: ASSESSMENT_ID });

    expect(res.meta.dataGranularity).toBe('aggregate_only');
    expect(res.meta.hasItemLevelData).toBe(false);
    expect(res.meta.capabilities).toContain('cohort_item_stats');
    expect(res.meta.capabilities).not.toContain('psychometrics');

    // Lo que el endpoint PROMETE en `capabilities`, ahora lo cumple.
    const i2 = res.items.find((i) => i.position === 2)!;
    expect(i2.difficulty).toBeCloseTo(25);
    expect(i2.totalResponses).toBe(4);
    expect(i2.topDistractorKey).toBe('C');
    expect(res.skills.map((s) => s.averageAchievement)).toEqual([30, 80]);

    // Lo irreducible queda en null, no en cero: sin el puntaje de cada alumno no hay
    // 27% superior/inferior. Y sin discriminación no se infla `low_discrimination`.
    expect(res.items.every((i) => i.discrimination === null)).toBe(true);
    expect(res.items.every((i) => !i.flags.includes('low_discrimination'))).toBe(true);
    // §8.5 — el informe oficial no trae el % de cada alumno, así que no hay promedio.
    expect(res.summary.averageAchievement).toBeNull();
  });

  it('con datos agregados distribuye por banda leyendo el nivel importado, no re-clasificando el %', async () => {
    const svc = makeService(makeDb(aggregateSelectResults()));
    const res = await svc.getReport(makeUser(), { assessmentId: ASSESSMENT_ID });

    // El gráfico que el informe DIA existe para reproducir. Antes salía en cero: se
    // derivaba clasificando `percentage`, que acá es NULL.
    const dist = Object.fromEntries(res.bandDistribution!.map((b) => [b.key, b.count]));
    expect(dist).toEqual({ I: 1, II: 0, III: 1 });
    expect(res.summary.studentsEvaluated).toBe(2);
    // Contar por curso NO puede depender de `percentage` (§8.5): 2 alumnos, no 0.
    expect(res.courseComparison[0].studentsEvaluated).toBe(2);

    // El nivel legacy se deriva de la banda, así que el foco de intervención existe.
    expect(res.studentsAtRisk.map((s) => s.studentFullName)).toEqual(['Beto B']);
    expect(res.studentsAtRisk[0].performanceBand?.key).toBe('I');
  });

  // Regresión §5.2: getReport DEBE correr dentro de withOrgContext. Con el mock
  // RLS-aware, `this.db` (sin contexto) devuelve 0 filas y sólo el `tx` de la
  // transacción ve datos. Si alguien quita el withOrgContext, requireAssessment
  // leería de `this.db` → [] → NotFound y este test fallaría (reproduce el 404
  // que ocurría en AWS bajo el rol soe_app sin BYPASSRLS).
  it('resuelve el informe SOLO dentro del contexto de org (withOrgContext / RLS)', async () => {
    const svc = makeService(makeRlsAwareDb(baseSelectResults()));
    const res = await svc.getReport(makeUser(), { assessmentId: ASSESSMENT_ID });

    expect(res.meta.assessmentId).toBe(ASSESSMENT_ID);
    expect(res.summary.studentsEvaluated).toBe(4);
  });
});
