import type { Database } from '@soe/db';
import { capabilitiesFor, type AssessmentReportResponse } from '@soe/types';
import { SnapshotService } from './ai-analysis.snapshot';
import { kr20, pointBiserial, type ScoreMatrix } from './ai-analysis.metrics';
import type { AssessmentReportService } from '../assessment-report/assessment-report.service';

// ──────────────────────────────────────────────────────────────────────────────
// Mock de Database: cada select() consume el siguiente resultado de una cola, en
// el orden en que el service ejecuta las queries dentro de withOrgContext:
//   1) items ⋈ responses        (loadItemMeta)
//   2) item_taxonomy_tags        (loadSkillNodeByItem)
//   3) responses (distribución)  (loadDistributionByItem)
//   4) responses (matriz)        (loadScoreMatrix)
//   5) skill_results bajo umbral (loadStudentsBelowThreshold)
// transaction() ejecuta el callback con el mismo db (withOrgContext lo envuelve).
// ──────────────────────────────────────────────────────────────────────────────

type AnyChain = Record<string, (...args: unknown[]) => unknown>;

function makeDb(selectResults: unknown[][]): Database {
  let idx = 0;
  function chain(rows: unknown[]): AnyChain {
    const c: AnyChain = {
      from: () => c,
      where: () => c,
      innerJoin: () => c,
      leftJoin: () => c,
      groupBy: () => c,
      orderBy: () => c,
      limit: () => c,
      then: (resolve: unknown) => Promise.resolve(rows).then(resolve as (v: unknown) => unknown),
    };
    return c;
  }
  const db = {
    select: () => {
      const rows = selectResults[idx] ?? [];
      idx++;
      return chain(rows);
    },
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
  } as unknown as Database;
  return db;
}

function makeReport(overrides: Partial<AssessmentReportResponse> = {}): AssessmentReportResponse {
  return {
    meta: {
      assessmentId: 'a1',
      assessmentName: 'Prueba',
      instrumentId: 'i1',
      instrumentName: 'Instrumento DIA',
      instrumentType: 'standardized',
      subjectName: 'Lenguaje',
      gradeName: '3° Básico',
      administeredAt: null,
      classGroups: [],
      itemsCount: 2,
      dataGranularity: 'item_level',
      capabilities: [...capabilitiesFor('item_level')],
      ...overrides.meta,
    },
    summary: {
      studentsEvaluated: 4,
      studentsEnrolled: 5,
      coverageRate: 80,
      averageAchievement: 60,
      hasGradingScale: true,
      averageGrade: 4.2,
      passingGrade: 4,
      passingRate: 75,
      performanceLevel: 'adequate',
      ...overrides.summary,
    },
    distribution: overrides.distribution ?? [],
    courseComparison: overrides.courseComparison ?? [],
    skills: overrides.skills ?? [
      {
        nodeId: 'node-skill-1',
        nodeName: 'Localizar información',
        nodeType: 'skill',
        nodeCode: 'LI',
        studentsAssessed: 4,
        averageAchievement: 55,
        performanceLevel: 'elementary',
      },
    ],
    highlights: overrides.highlights ?? { strengths: [], gaps: [] },
    items: overrides.items ?? [
      {
        itemId: 'it1',
        position: 1,
        skillName: 'Localizar información',
        contentName: null,
        correctKey: 'A',
        answeredCount: 4,
        blankCount: 0,
        totalResponses: 4,
        difficulty: 75,
        discrimination: 0.4,
        topDistractorKey: 'B',
        topDistractorRate: 25,
        flags: [],
      },
      {
        itemId: 'it2',
        position: 2,
        skillName: 'Localizar información',
        contentName: null,
        correctKey: 'C',
        answeredCount: 4,
        blankCount: 0,
        totalResponses: 4,
        difficulty: 50,
        discrimination: 0.2,
        topDistractorKey: 'D',
        topDistractorRate: 50,
        flags: [],
      },
    ],
    studentsAtRisk: overrides.studentsAtRisk ?? [],
    recommendations: overrides.recommendations ?? [],
  };
}

function makeReportService(report: AssessmentReportResponse): AssessmentReportService {
  return {
    getReport: jest.fn().mockResolvedValue(report),
  } as unknown as AssessmentReportService;
}

function makeService(db: Database, reportService: AssessmentReportService): SnapshotService {
  return new (SnapshotService as new (
    db: Database,
    rs: AssessmentReportService,
  ) => SnapshotService)(db, reportService);
}

// Cola estándar de DB para los 2 ítems / 4 alumnos del informe base.
function defaultDbQueues(): unknown[][] {
  return [
    // 1) items ⋈ responses
    [
      { itemId: 'it1', position: 1, content: { stem: '¿Cuál es la idea principal?' } },
      { itemId: 'it2', position: 2, content: { stem: 'Selecciona el sinónimo' } },
    ],
    // 2) item_taxonomy_tags
    [
      { itemId: 'it1', nodeId: 'node-skill-1', nodeType: 'skill' },
      { itemId: 'it2', nodeId: 'node-skill-1', nodeType: 'skill' },
    ],
    // 3) distribución de respuestas
    [
      { itemId: 'it1', answer: 'A', count: 3 },
      { itemId: 'it1', answer: 'B', count: 1 },
      { itemId: 'it2', answer: 'C', count: 2 },
      { itemId: 'it2', answer: 'D', count: 2 },
    ],
    // 4) matriz de aciertos (alumno × ítem)
    [
      { studentId: 's1', itemId: 'it1', isCorrect: true },
      { studentId: 's1', itemId: 'it2', isCorrect: true },
      { studentId: 's2', itemId: 'it1', isCorrect: true },
      { studentId: 's2', itemId: 'it2', isCorrect: false },
      { studentId: 's3', itemId: 'it1', isCorrect: true },
      { studentId: 's3', itemId: 'it2', isCorrect: false },
      { studentId: 's4', itemId: 'it1', isCorrect: false },
      { studentId: 's4', itemId: 'it2', isCorrect: false },
    ],
    // 5) skill_results bajo umbral
    [{ nodeId: 'node-skill-1', count: 2 }],
  ];
}

// ──────────────────────────────────────────────────────────────────────────────
// Métricas puras: KR-20
// ──────────────────────────────────────────────────────────────────────────────

describe('kr20', () => {
  it('devuelve null con menos de 2 ítems', () => {
    expect(kr20([[true], [false]])).toBeNull();
  });

  it('devuelve null sin alumnos', () => {
    expect(kr20([])).toBeNull();
  });

  it('devuelve null si todos los puntajes totales son iguales (varianza 0)', () => {
    // Todos sacan 1 de 2 → varianza total 0.
    const matrix: ScoreMatrix = [
      [true, false],
      [true, false],
      [true, false],
    ];
    expect(kr20(matrix)).toBeNull();
  });

  it('calcula KR-20 determinista para una matriz conocida', () => {
    // 4 alumnos, 2 ítems. Totales: 2,1,1,0.
    const matrix: ScoreMatrix = [
      [true, true],
      [true, false],
      [true, false],
      [false, false],
    ];
    // p1=3/4=.75 (pq=.1875), p2=1/4=.25 (pq=.1875) → Σpq=.375
    // totales 2,1,1,0 → media 1, var=( 1+0+0+1)/4=.5
    // KR20 = (2/1)*(1 - .375/.5) = 2*(1-.75) = 0.5
    const v = kr20(matrix);
    expect(v).not.toBeNull();
    expect(v as number).toBeCloseTo(0.5, 6);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Métricas puras: punto-biserial
// ──────────────────────────────────────────────────────────────────────────────

describe('pointBiserial', () => {
  it('devuelve null si el ítem no varía (todos aciertan)', () => {
    const matrix: ScoreMatrix = [
      [true, true],
      [true, false],
    ];
    expect(pointBiserial(matrix, 0)).toBeNull();
  });

  it('índice fuera de rango → null', () => {
    const matrix: ScoreMatrix = [[true, false]];
    expect(pointBiserial(matrix, 5)).toBeNull();
  });

  it('es positivo cuando el ítem alinea con el puntaje total', () => {
    // Quienes aciertan el ítem 1 tienden a tener mejor total.
    const matrix: ScoreMatrix = [
      [true, true, true],
      [true, true, false],
      [false, false, true],
      [false, false, false],
    ];
    const r = pointBiserial(matrix, 0);
    expect(r).not.toBeNull();
    expect(r as number).toBeGreaterThan(0);
    expect(r as number).toBeLessThanOrEqual(1);
  });

  it('es negativo cuando el ítem contradice el puntaje total', () => {
    // El ítem 0 lo aciertan justamente los de peor total.
    const matrix: ScoreMatrix = [
      [false, true, true],
      [false, true, true],
      [true, false, false],
      [true, false, false],
    ];
    const r = pointBiserial(matrix, 0);
    expect(r).not.toBeNull();
    expect(r as number).toBeLessThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SnapshotService.build
// ──────────────────────────────────────────────────────────────────────────────

describe('SnapshotService.build', () => {
  it('reusa AssessmentReportService con el orgId del token (no del body)', async () => {
    const report = makeReport();
    const rs = makeReportService(report);
    const svc = makeService(makeDb(defaultDbQueues()), rs);

    await svc.build('a1', 'org-99');

    const call = (rs.getReport as jest.Mock).mock.calls[0];
    const user = call[0];
    const query = call[1];
    expect(user.orgId).toBe('org-99');
    expect(user.isPlatformAdmin).toBe(false);
    expect(query.assessmentId).toBe('a1');
  });

  it('ensambla items con p (0..1), discriminación, punto-biserial, distractor y stem', async () => {
    const rs = makeReportService(makeReport());
    const svc = makeService(makeDb(defaultDbQueues()), rs);

    const snap = await svc.build('a1', 'org-1');

    expect(snap.items).toHaveLength(2);
    const it1 = snap.items[0];
    expect(it1.position).toBe(1);
    expect(it1.difficulty).toBeCloseTo(0.75, 6); // 75% → 0.75
    expect(it1.discrimination).toBe(0.4);
    expect(it1.correctLabel).toBe('A');
    expect(it1.dominantDistractor).toBe('B');
    expect(it1.nodeId).toBe('node-skill-1');
    expect(it1.stem).toBe('¿Cuál es la idea principal?');
    expect(it1.distribution).toEqual({ A: 3, B: 1 });
    expect(it1.pointBiserial).not.toBeNull();
  });

  it('calcula reliability.kr20 sobre la matriz de aciertos', async () => {
    const rs = makeReportService(makeReport());
    const svc = makeService(makeDb(defaultDbQueues()), rs);

    const snap = await svc.build('a1', 'org-1');
    // Misma matriz que el test puro de kr20 → 0.5.
    expect(snap.reliability.kr20).not.toBeNull();
    expect(snap.reliability.kr20 as number).toBeCloseTo(0.5, 6);
  });

  it('ensambla skills con cobertura blueprint (itemCount) y studentsBelowThreshold', async () => {
    const rs = makeReportService(makeReport());
    const svc = makeService(makeDb(defaultDbQueues()), rs);

    const snap = await svc.build('a1', 'org-1');
    expect(snap.skills).toHaveLength(1);
    const skill = snap.skills[0];
    expect(skill.nodeId).toBe('node-skill-1');
    expect(skill.itemCount).toBe(2); // dos ítems mapean al nodo
    expect(skill.expectedItemCount).toBeNull();
    expect(skill.studentsBelowThreshold).toBe(2);
    expect(skill.achievement).toBe(55);
  });

  it('propaga contadores y metadatos del informe (evaluados, matriculados, nombres)', async () => {
    const rs = makeReportService(makeReport());
    const svc = makeService(makeDb(defaultDbQueues()), rs);

    const snap = await svc.build('a1', 'org-1');
    expect(snap.assessmentId).toBe('a1');
    expect(snap.evaluated).toBe(4);
    expect(snap.enrolled).toBe(5);
    expect(snap.instrumentName).toBe('Instrumento DIA');
    expect(snap.gradeName).toBe('3° Básico');
    expect(snap.subjectName).toBe('Lenguaje');
  });

  it('NO incluye PII: ningún campo expone nombres ni RUT de alumnos', async () => {
    const rs = makeReportService(makeReport());
    const svc = makeService(makeDb(defaultDbQueues()), rs);

    const snap = await svc.build('a1', 'org-1');
    const serialized = JSON.stringify(snap);
    // Los ids de alumno (s1..s4) y cualquier rut/nombre no deben filtrarse.
    expect(serialized).not.toContain('s1');
    expect(serialized).not.toContain('rut');
    expect(serialized).not.toContain('studentId');
    // El stem (contenido del ítem, no PII) sí está presente.
    expect(serialized).toContain('idea principal');
  });

  it('maneja evaluación vacía: sin items/skills, kr20 null, contadores en 0', async () => {
    const emptyReport = makeReport({
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
      items: [],
      skills: [],
    });
    const rs = makeReportService(emptyReport);
    // Todas las queries devuelven [].
    const svc = makeService(makeDb([[], [], [], [], []]), rs);

    const snap = await svc.build('a1', 'org-1');
    expect(snap.items).toEqual([]);
    expect(snap.skills).toEqual([]);
    expect(snap.reliability.kr20).toBeNull();
    expect(snap.evaluated).toBe(0);
    expect(snap.enrolled).toBe(0);
  });

  it('difficulty null en el informe se propaga como null (no divide)', async () => {
    const report = makeReport({
      items: [
        {
          itemId: 'it1',
          position: 1,
          skillName: null,
          contentName: null,
          correctKey: null,
          answeredCount: 0,
          blankCount: 0,
          totalResponses: 0,
          difficulty: null,
          discrimination: null,
          topDistractorKey: null,
          topDistractorRate: null,
          flags: [],
        },
      ],
    });
    const rs = makeReportService(report);
    const queues: unknown[][] = [[{ itemId: 'it1', position: 1, content: {} }], [], [], [], []];
    const svc = makeService(makeDb(queues), rs);

    const snap = await svc.build('a1', 'org-1');
    expect(snap.items[0].difficulty).toBeNull();
    expect(snap.items[0].stem).toBeNull();
    expect(snap.items[0].pointBiserial).toBeNull(); // ítem no está en la matriz
  });
});
