import type { Database } from '@soe/db';
import type { AssessmentReportItemRow, AssessmentReportResponse, UserRole } from '@soe/types';
import { capabilitiesFor } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { AssessmentReportService } from '../assessment-report/assessment-report.service';
import { InstrumentQualityService } from './instrument-quality.service';

// ──────────────────────────────────────────────────────────────────────────────
// Mock de Database: cada `select()` consume el siguiente array de `selectResults`
// en orden (mismo estilo que item-analysis.service.spec.ts). withOrgContext abre
// una transacción cuyo tx es el propio mock.
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
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  } as unknown as Database;

  return db;
}

const ASSESSMENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const INSTRUMENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CLASS_GROUP_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const ITEM = (n: number) => `0000000${n}-0000-0000-0000-000000000000`;
const STUDENT = (n: number) => `1000000${n}-0000-0000-0000-000000000000`;

/** Fila de ítem del informe con valores por defecto "sanos" (sin banderas). */
function itemRow(overrides: Partial<AssessmentReportItemRow> = {}): AssessmentReportItemRow {
  return {
    itemId: ITEM(1),
    position: 1,
    skillName: 'Localizar información',
    contentName: 'Lectura',
    correctKey: 'B',
    answeredCount: 10,
    blankCount: 0,
    totalResponses: 10,
    difficulty: 60,
    discrimination: 0.45,
    topDistractorKey: 'A',
    topDistractorRate: 20,
    flags: [],
    ...overrides,
  };
}

/** Construye un report mock con las filas de ítems dadas. */
function makeReport(items: AssessmentReportItemRow[]): AssessmentReportResponse {
  return {
    meta: {
      assessmentId: ASSESSMENT_ID,
      assessmentName: 'DIA Lectura',
      instrumentId: 'inst-1',
      instrumentName: 'Instrumento Lectura',
      instrumentType: 'dia',
      subjectName: 'Lenguaje',
      gradeName: '4° básico',
      administeredAt: null,
      classGroups: [{ id: CLASS_GROUP_ID, name: '4°A' }],
      itemsCount: items.length,
      dataGranularity: 'item_level',
      capabilities: [...capabilitiesFor('item_level')],
      hasItemLevelData: true,
    },
    summary: {
      studentsEvaluated: 0,
      studentsEnrolled: 0,
      coverageRate: null,
      averageAchievement: null,
      hasGradingScale: true,
      averageGrade: null,
      passingGrade: 4,
      passingRate: null,
      performanceLevel: null,
    },
    distribution: [],
    courseComparison: [],
    skills: [],
    highlights: { strengths: [], gaps: [] },
    items,
    studentsAtRisk: [],
    recommendations: [],
  };
}

function makeReportService(report: AssessmentReportResponse): {
  service: AssessmentReportService;
  getReport: jest.Mock;
} {
  const getReport = jest.fn().mockResolvedValue(report);
  const service = { getReport } as unknown as AssessmentReportService;
  return { service, getReport };
}

function makeService(
  db: Database,
  reportService: AssessmentReportService,
): InstrumentQualityService {
  return new (InstrumentQualityService as new (
    db: Database,
    report: AssessmentReportService,
  ) => InstrumentQualityService)(db, reportService);
}

/** Filas de `responses` (studentId/itemId/isCorrect) a partir de una matriz. */
function responseRows(
  matrix: boolean[][],
  itemIds: string[],
): { studentId: string; itemId: string; isCorrect: boolean }[] {
  const rows: { studentId: string; itemId: string; isCorrect: boolean }[] = [];
  matrix.forEach((row, s) => {
    row.forEach((correct, i) => {
      rows.push({ studentId: STUDENT(s), itemId: itemIds[i], isCorrect: correct });
    });
  });
  return rows;
}

// Selects para admin (scopeAll, sin classGroupId): [instrumentId], [responses].
function adminSelects(responses: unknown[]): unknown[][] {
  return [[{ instrumentId: INSTRUMENT_ID }], responses];
}

describe('InstrumentQualityService', () => {
  it('happy path: arma respuesta con shape de InstrumentQualityResponse y flaggedCount', async () => {
    const items = [itemRow({ itemId: ITEM(1), position: 1 })];
    const { service: reportService } = makeReportService(makeReport(items));
    // Matriz con discriminación clara para que el ítem NO levante banderas.
    const matrix = [[true], [true], [false], [false]];
    const db = makeDb(adminSelects(responseRows(matrix, [ITEM(1)])));
    const svc = makeService(db, reportService);

    const res = await svc.getQuality(makeUser(), { assessmentId: ASSESSMENT_ID });

    expect(res.assessmentId).toBe(ASSESSMENT_ID);
    expect(res.instrumentId).toBe(INSTRUMENT_ID);
    expect(res.instrumentName).toBe('Instrumento Lectura');
    expect(res.assessmentName).toBe('DIA Lectura');
    expect(res.items).toHaveLength(1);
    expect(res.reliability.studentsAnalyzed).toBe(4);
    expect(res.reliability.itemsAnalyzed).toBe(1);
    // Sin banderas → flaggedCount 0.
    expect(res.items[0].flags).toEqual([]);
    expect(res.flaggedCount).toBe(0);
  });

  it('flag low_discrimination cuando D < 0.20', async () => {
    const items = [itemRow({ discrimination: 0.1, difficulty: 60 })];
    const { service: reportService } = makeReportService(makeReport(items));
    const matrix = [[true], [false]];
    const db = makeDb(adminSelects(responseRows(matrix, [ITEM(1)])));
    const svc = makeService(db, reportService);

    const res = await svc.getQuality(makeUser(), { assessmentId: ASSESSMENT_ID });

    expect(res.items[0].flags).toContain('low_discrimination');
    expect(res.flaggedCount).toBe(1);
    // Cada flag genera su sugerencia determinista.
    expect(res.items[0].suggestions.length).toBe(res.items[0].flags.length);
    expect(res.items[0].suggestions[0]).toMatch(/discrimina/i);
  });

  it('flag too_easy cuando p > 90%', async () => {
    const items = [itemRow({ difficulty: 95, discrimination: 0.4, topDistractorRate: 2 })];
    const { service: reportService } = makeReportService(makeReport(items));
    const matrix = [[true], [true], [false]];
    const db = makeDb(adminSelects(responseRows(matrix, [ITEM(1)])));
    const svc = makeService(db, reportService);

    const res = await svc.getQuality(makeUser(), { assessmentId: ASSESSMENT_ID });

    expect(res.items[0].flags).toContain('too_easy');
  });

  it('flag strong_distractor cuando un distractor supera el 35%', async () => {
    const items = [itemRow({ difficulty: 50, discrimination: 0.4, topDistractorRate: 40 })];
    const { service: reportService } = makeReportService(makeReport(items));
    const matrix = [[true], [false]];
    const db = makeDb(adminSelects(responseRows(matrix, [ITEM(1)])));
    const svc = makeService(db, reportService);

    const res = await svc.getQuality(makeUser(), { assessmentId: ASSESSMENT_ID });

    expect(res.items[0].flags).toContain('strong_distractor');
  });

  it('flag strong_distractor cuando el distractor iguala o supera a la clave (tasa ≥ p)', async () => {
    // distractor 30% ≥ dificultad 25% → distractor potente aunque < 35%.
    const items = [itemRow({ difficulty: 25, discrimination: 0.4, topDistractorRate: 30 })];
    const { service: reportService } = makeReportService(makeReport(items));
    const matrix = [[true], [false]];
    const db = makeDb(adminSelects(responseRows(matrix, [ITEM(1)])));
    const svc = makeService(db, reportService);

    const res = await svc.getQuality(makeUser(), { assessmentId: ASSESSMENT_ID });

    expect(res.items[0].flags).toContain('strong_distractor');
  });

  it('flag misaligned cuando el ítem no tiene tags (skill y content null)', async () => {
    const items = [itemRow({ skillName: null, contentName: null, discrimination: 0.4 })];
    const { service: reportService } = makeReportService(makeReport(items));
    const matrix = [[true], [false]];
    const db = makeDb(adminSelects(responseRows(matrix, [ITEM(1)])));
    const svc = makeService(db, reportService);

    const res = await svc.getQuality(makeUser(), { assessmentId: ASSESSMENT_ID });

    expect(res.items[0].flags).toContain('misaligned');
  });

  it('flag ambiguous_key cuando el punto-biserial es bajo o negativo', async () => {
    // Dos ítems: el ítem evaluado se acierta de forma INVERSA al puntaje total
    // (quien acierta el resto, falla este) → punto-biserial negativo.
    const items = [
      itemRow({ itemId: ITEM(1), position: 1, discrimination: 0.4 }),
      itemRow({ itemId: ITEM(2), position: 2, discrimination: 0.4 }),
    ];
    const { service: reportService } = makeReportService(makeReport(items));
    // Col 0 = ítem evaluado; col 1 = ancla del total.
    const matrix = [
      [false, true],
      [false, true],
      [true, false],
      [true, false],
    ];
    const db = makeDb(adminSelects(responseRows(matrix, [ITEM(1), ITEM(2)])));
    const svc = makeService(db, reportService);

    const res = await svc.getQuality(makeUser(), { assessmentId: ASSESSMENT_ID });

    expect(res.items[0].pointBiserial).not.toBeNull();
    expect(res.items[0].pointBiserial!).toBeLessThan(0.1);
    expect(res.items[0].flags).toContain('ambiguous_key');
  });

  it('KR-20: interpretación determinista por rango', async () => {
    const ranges: Array<[number | null, string]> = [
      [0.95, 'Excelente'],
      [0.85, 'Buena'],
      [0.75, 'Aceptable'],
      [0.65, 'Cuestionable'],
      [0.3, 'Pobre'],
      [null, 'No calculable'],
    ];
    const svc = makeService(makeDb([]), makeReportService(makeReport([])).service);
    const interpret = (
      svc as unknown as { interpretKr20: (v: number | null) => string }
    ).interpretKr20.bind(svc);
    for (const [value, label] of ranges) {
      expect(interpret(value)).toBe(label);
    }
  });

  it('KR-20 nulo (1 solo ítem → no calculable) en la respuesta', async () => {
    const items = [itemRow({ discrimination: 0.4 })];
    const { service: reportService } = makeReportService(makeReport(items));
    const matrix = [[true], [false], [true]];
    const db = makeDb(adminSelects(responseRows(matrix, [ITEM(1)])));
    const svc = makeService(db, reportService);

    const res = await svc.getQuality(makeUser(), { assessmentId: ASSESSMENT_ID });

    // k < 2 → kr20 null → interpretación "No calculable".
    expect(res.reliability.kr20).toBeNull();
    expect(res.reliability.interpretation).toBe('No calculable');
  });

  it('scoping profesor: usa studentFilter de sus cursos para armar la matriz', async () => {
    const items = [itemRow({ discrimination: 0.4 })];
    const { service: reportService, getReport } = makeReportService(makeReport(items));
    // Profesor (no admin-like): selects = [instrumentId], [scope classGroups],
    // [studentFilter], [responses].
    const teacherClassGroups = [{ classGroupId: CLASS_GROUP_ID }];
    const scopedStudents = [{ studentId: STUDENT(0) }, { studentId: STUDENT(1) }];
    const matrix = [[true], [false]];
    const db = makeDb([
      [{ instrumentId: INSTRUMENT_ID }],
      teacherClassGroups,
      scopedStudents,
      responseRows(matrix, [ITEM(1)]),
    ]);
    const svc = makeService(db, reportService);

    const res = await svc.getQuality(makeUser({ role: 'teacher' }), {
      assessmentId: ASSESSMENT_ID,
    });

    // El informe (que valida el scope) se llamó con el mismo usuario/dto.
    expect(getReport).toHaveBeenCalledTimes(1);
    expect(res.reliability.studentsAnalyzed).toBe(2);
  });

  it('sin PII: la respuesta no expone nombres ni RUT de alumnos', async () => {
    const items = [itemRow({ discrimination: 0.4 })];
    const { service: reportService } = makeReportService(makeReport(items));
    const matrix = [[true], [false]];
    const db = makeDb(adminSelects(responseRows(matrix, [ITEM(1)])));
    const svc = makeService(db, reportService);

    const res = await svc.getQuality(makeUser(), { assessmentId: ASSESSMENT_ID });

    const serialized = JSON.stringify(res);
    expect(serialized).not.toMatch(/rut/i);
    expect(serialized).not.toMatch(/studentId/);
    expect(serialized).not.toMatch(/firstName|lastName|fullName/i);
  });
});
