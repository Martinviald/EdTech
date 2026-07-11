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
  return new (AssessmentReportService as new (db: Database) => AssessmentReportService)(
    db,
  );
}

const ASSESSMENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// Escenario base: 4 alumnos evaluados, 2 ítems, 2 cursos. gradingScaleId null →
// nota de corte por defecto (4.0) sin query extra.
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
        gradingScaleId: null,
        gradingScaleConfig: null,
      },
    ],
    // 1. loadAssessmentClassGroups
    [
      { id: 'cg1', name: '3°A', gradeName: '3° Básico' },
      { id: 'cg2', name: '3°B', gradeName: '3° Básico' },
    ],
    // 2. loadItemColumns → items
    [
      { itemId: 'i1', position: 1, content: { correctKey: 'A' } },
      { itemId: 'i2', position: 2, content: { correctKey: 'B' } },
    ],
    // 3. loadTagsByItems
    [
      { itemId: 'i1', nodeName: 'Localizar información', nodeType: 'skill' },
      { itemId: 'i2', nodeName: 'Interpretar', nodeType: 'skill' },
    ],
    // 4. loadEvaluatedStudents
    [
      { studentId: 's1', studentRut: '1-9', firstName: 'Ana', lastName: 'A', percentage: '90.00', grade: '6.30', performanceLevel: 'advanced' },
      { studentId: 's2', studentRut: '2-7', firstName: 'Beto', lastName: 'B', percentage: '75.00', grade: '5.00', performanceLevel: 'adequate' },
      { studentId: 's3', studentRut: '3-5', firstName: 'Caro', lastName: 'C', percentage: '45.00', grade: '3.50', performanceLevel: 'elementary' },
      { studentId: 's4', studentRut: '4-3', firstName: 'Dani', lastName: 'D', percentage: '20.00', grade: '2.00', performanceLevel: 'insufficient' },
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
    // 7. loadItemDistribution (group by item, answer, isCorrect)
    [
      { itemId: 'i1', answer: 'A', isCorrect: true, count: 3 },
      { itemId: 'i1', answer: 'B', isCorrect: false, count: 1 },
      { itemId: 'i2', answer: 'B', isCorrect: true, count: 1 },
      { itemId: 'i2', answer: 'C', isCorrect: false, count: 3 },
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
    // 10. buildSkills
    [
      { nodeId: 'n2', nodeName: 'Interpretar', nodeType: 'skill', nodeCode: null, avgPct: '30.00', studentsAssessed: 4 },
      { nodeId: 'n1', nodeName: 'Localizar información', nodeType: 'skill', nodeCode: null, avgPct: '80.00', studentsAssessed: 4 },
    ],
    // 11. loadWeakestSkillPerStudent (atRisk = s3, s4)
    [
      { studentId: 's4', nodeName: 'Interpretar', percentage: '10.00' },
      { studentId: 's3', nodeName: 'Interpretar', percentage: '20.00' },
    ],
  ];
}

describe('AssessmentReportService.getReport', () => {
  it('arma la síntesis ejecutiva con cobertura, aprobación y nivel global', async () => {
    const svc = makeService(makeDb(baseSelectResults()));
    const res = await svc.getReport(makeUser(), { assessmentId: ASSESSMENT_ID });

    expect(res.summary.studentsEvaluated).toBe(4);
    expect(res.summary.studentsEnrolled).toBe(5);
    expect(res.summary.coverageRate).toBeCloseTo(80);
    expect(res.summary.averageAchievement).toBeCloseTo(57.5);
    expect(res.summary.averageGrade).toBeCloseTo(4.2);
    expect(res.summary.passingGrade).toBe(4.0);
    expect(res.summary.passingRate).toBeCloseTo(50); // 6.30 y 5.00 aprueban
    expect(res.summary.performanceLevel).toBe('elementary'); // 57.5% → elemental
    expect(res.meta.itemsCount).toBe(2);
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

  it('devuelve un informe vacío bien formado cuando no hay alumnos evaluados', async () => {
    const results = baseSelectResults();
    results[4] = []; // loadEvaluatedStudents sin filas
    const svc = makeService(makeDb(results));
    const res = await svc.getReport(makeUser(), { assessmentId: ASSESSMENT_ID });

    expect(res.summary.studentsEvaluated).toBe(0);
    expect(res.summary.averageAchievement).toBeNull();
    expect(res.courseComparison).toEqual([]);
    expect(res.studentsAtRisk).toEqual([]);
    // Los ítems siguen listándose (estructura), pero sin métricas.
    expect(res.items).toHaveLength(2);
    expect(res.items[0].difficulty).toBeNull();
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
