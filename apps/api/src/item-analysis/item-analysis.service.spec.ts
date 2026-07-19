import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Database } from '@soe/db';
import type { UserRole } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { ItemAnalysisService } from './item-analysis.service';

// ──────────────────────────────────────────────────────────────────────────────
// Mock de Database: cada llamada a `select()` consume la siguiente respuesta de
// `selectResults` en orden. El builder es encadenable y resuelve a un array al
// hacer `await`. Mismo estilo que analytics.service.spec.ts.
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
    // withOrgContext() abre una transacción y fija app.current_org_id vía
    // tx.execute antes de correr el callback. El tx es el propio mock.
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    __selectCalls: () => selectIdx,
  } as unknown as DbMock;

  return db;
}

function makeService(db: Database): ItemAnalysisService {
  return new (ItemAnalysisService as new (db: Database) => ItemAnalysisService)(db);
}

const ASSESSMENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const INSTRUMENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ITEM_A = '11111111-1111-1111-1111-111111111111';
const ITEM_B = '22222222-2222-2222-2222-222222222222';
const STUDENT_1 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const STUDENT_2 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const CLASS_GROUP_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const NODE_SKILL = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const NODE_CONTENT = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0';

const assessmentRow = {
  id: ASSESSMENT_ID,
  orgId: 'org-1',
  instrumentId: INSTRUMENT_ID,
  name: 'DIA Lectura',
  instrumentName: 'Instrumento Lectura',
};

const itemRows = [
  {
    itemId: ITEM_A,
    position: 1,
    type: 'multiple_choice',
    content: {
      stem: 'Pregunta A',
      alternatives: [
        { key: 'A', text: 'Opción A' },
        { key: 'B', text: 'Opción B' },
      ],
      correctKey: 'B',
    },
    scoringConfig: { points: 1 },
  },
  {
    itemId: ITEM_B,
    position: 2,
    type: 'multiple_choice',
    content: {
      stem: 'Pregunta B',
      alternatives: [
        { key: 'A', text: 'Opción A', isCorrect: true },
        { key: 'B', text: 'Opción B' },
      ],
      // sin correctKey → se deriva de alternatives[].isCorrect
    },
    scoringConfig: { points: 1 },
  },
];

const tagRows = [
  {
    itemId: ITEM_A,
    tagType: 'primary',
    nodeId: NODE_SKILL,
    nodeName: 'Localizar información',
    nodeType: 'skill',
  },
  {
    itemId: ITEM_A,
    tagType: 'secondary',
    nodeId: NODE_CONTENT,
    nodeName: 'OA 1',
    nodeType: 'content',
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// getMatrix (H6.11)
// ──────────────────────────────────────────────────────────────────────────────

describe('ItemAnalysisService.getMatrix', () => {
  it('arma columnas y celdas en el mismo orden, con paginación (admin)', async () => {
    const db = makeDb([
      [assessmentRow], // requireAssessmentOwnedByUser
      // getAccessibleClassGroupIds → admin → sin query
      itemRows, // loadQuestionColumns → items
      tagRows, // loadTagsByItems
      // resolveAccessibleStudentIds → scopeAll, sin classGroupId → null (sin query)
      [
        // attachCorrectRates → group by item_id
        { itemId: ITEM_A, total: 2, correct: 1 },
        { itemId: ITEM_B, total: 2, correct: 2 },
      ],
      [{ total: 2 }], // loadStudentsPage → count
      [
        // loadStudentsPage → page
        {
          studentId: STUDENT_1,
          studentRut: '11.111.111-1',
          firstName: 'Ana',
          lastName: 'Soto',
          classGroupId: CLASS_GROUP_ID,
          classGroupName: '3A',
          percentage: '50.00',
        },
        {
          studentId: STUDENT_2,
          studentRut: '22.222.222-2',
          firstName: 'Beto',
          lastName: 'Vera',
          percentage: null,
        },
      ],
      [
        // loadStudentClassGroups → curso por alumno (1 query, dedupe en JS)
        { studentId: STUDENT_1, classGroupId: CLASS_GROUP_ID, classGroupName: '3A' },
        { studentId: STUDENT_2, classGroupId: CLASS_GROUP_ID, classGroupName: '3A' },
      ],
      [
        // loadCells
        {
          studentId: STUDENT_1,
          itemId: ITEM_A,
          value: { answer: 'B' },
          isCorrect: true,
          finalScore: '1.00',
          rawScore: '1.00',
        },
        {
          studentId: STUDENT_1,
          itemId: ITEM_B,
          value: { answer: 'B' },
          isCorrect: false,
          finalScore: null,
          rawScore: '0.00',
        },
        {
          studentId: STUDENT_2,
          itemId: ITEM_A,
          value: { answer: 'A' },
          isCorrect: false,
          finalScore: null,
          rawScore: null,
        },
      ],
    ]);
    const service = makeService(db);

    const res = await service.getMatrix(makeUser(), {
      assessmentId: ASSESSMENT_ID,
      page: 1,
      limit: 50,
      all: false,
    });

    expect(res.assessmentId).toBe(ASSESSMENT_ID);
    expect(res.instrumentName).toBe('Instrumento Lectura');
    expect(res.questions).toHaveLength(2);
    // Orden por position.
    expect(res.questions[0].itemId).toBe(ITEM_A);
    expect(res.questions[1].itemId).toBe(ITEM_B);
    // correctKey: A desde content.correctKey; B desde alternatives[].isCorrect.
    expect(res.questions[0].correctKey).toBe('B');
    expect(res.questions[1].correctKey).toBe('A');
    // skill / content derivados de tags.
    expect(res.questions[0].skill?.nodeId).toBe(NODE_SKILL);
    expect(res.questions[0].content?.nodeId).toBe(NODE_CONTENT);
    // correctRate agregado.
    expect(res.questions[0].correctRate).toBe(50);
    expect(res.questions[1].correctRate).toBe(100);
    // TKT-22 — admin sin filtro: la población visible ya es toda la org, así que
    // references.org = correctRate sin query adicional. `sample` DIFERIDO (ausente).
    expect(res.questions[0].references.org).toBe(50);
    expect(res.questions[1].references.org).toBe(100);
    expect(res.questions[0].references.sample).toBeUndefined();

    // Paginación.
    expect(res.students.total).toBe(2);
    expect(res.students.page).toBe(1);
    expect(res.students.data).toHaveLength(2);

    // Celdas en el mismo orden que questions.
    const row1 = res.students.data[0];
    expect(row1.studentFullName).toBe('Ana Soto');
    // Curso resuelto vía loadStudentClassGroups (no por el join de la página).
    expect(row1.classGroupName).toBe('3A');
    expect(row1.classGroupId).toBe(CLASS_GROUP_ID);
    expect(row1.cells.map((c) => c.itemId)).toEqual([ITEM_A, ITEM_B]);
    expect(row1.cells[0].selectedKey).toBe('B');
    expect(row1.cells[0].isCorrect).toBe(true);
    expect(row1.cells[0].score).toBe(1);
    expect(row1.correctCount).toBe(1);
    expect(row1.answeredCount).toBe(2);
    // achievement desde assessment_results.percentage.
    expect(row1.achievement).toBe(50);

    // Alumno sin percentage → derivado de correctCount/answeredCount.
    const row2 = res.students.data[1];
    expect(row2.cells[1].itemId).toBe(ITEM_B);
    expect(row2.cells[1].selectedKey).toBeNull(); // sin respuesta a ITEM_B
    expect(row2.correctCount).toBe(0);
    expect(row2.answeredCount).toBe(1);
    expect(row2.achievement).toBe(0);
  });

  it('lanza NotFound si la evaluación no existe', async () => {
    const db = makeDb([[]]); // requireAssessmentOwnedByUser → vacío
    const service = makeService(db);
    await expect(
      service.getMatrix(makeUser(), {
        assessmentId: ASSESSMENT_ID,
        page: 1,
        limit: 50,
        all: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lanza NotFound si la evaluación es de otra org', async () => {
    const db = makeDb([[{ ...assessmentRow, orgId: 'org-OTRA' }]]);
    const service = makeService(db);
    await expect(
      service.getMatrix(makeUser(), {
        assessmentId: ASSESSMENT_ID,
        page: 1,
        limit: 50,
        all: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lanza Forbidden si un profesor no tiene scope sobre la evaluación', async () => {
    const db = makeDb([
      [assessmentRow], // requireAssessmentOwnedByUser
      [{ classGroupId: 'cg-otro' }], // getAccessibleClassGroupIds → profesor con otros cursos
      [], // assessmentTouchesScope → no toca su scope
    ]);
    const service = makeService(db);
    await expect(
      service.getMatrix(makeUser({ role: 'teacher' }), {
        assessmentId: ASSESSMENT_ID,
        page: 1,
        limit: 50,
        all: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('profesor con scope: limita alumnos a su classGroup (resolveAccessibleStudentIds)', async () => {
    const db = makeDb([
      [assessmentRow], // requireAssessmentOwnedByUser
      [{ classGroupId: CLASS_GROUP_ID }], // getAccessibleClassGroupIds
      [{ classGroupId: CLASS_GROUP_ID }], // assessmentTouchesScope → ok
      itemRows, // loadQuestionColumns → items
      tagRows, // loadTagsByItems
      [{ studentId: STUDENT_1 }], // resolveAccessibleStudentIds (teacher, sin classGroupId param)
      [{ itemId: ITEM_A, total: 1, correct: 1 }], // attachCorrectRates (scope profesor → 100%)
      [{ itemId: ITEM_A, total: 4, correct: 2 }], // attachOrgReferences (colegio → 50%)
      [{ total: 1 }], // loadStudentsPage count
      [
        {
          studentId: STUDENT_1,
          studentRut: '11.111.111-1',
          firstName: 'Ana',
          lastName: 'Soto',
          percentage: '80.00',
        },
      ],
      [
        // loadStudentClassGroups
        { studentId: STUDENT_1, classGroupId: CLASS_GROUP_ID, classGroupName: '3A' },
      ],
      [
        {
          studentId: STUDENT_1,
          itemId: ITEM_A,
          value: { answer: 'B' },
          isCorrect: true,
          finalScore: '1.00',
          rawScore: '1.00',
        },
      ],
    ]);
    const service = makeService(db);

    const res = await service.getMatrix(makeUser({ role: 'teacher' }), {
      assessmentId: ASSESSMENT_ID,
      page: 1,
      limit: 50,
      all: false,
    });
    expect(res.students.total).toBe(1);
    expect(res.students.data[0].studentId).toBe(STUDENT_1);
    expect(res.students.data[0].achievement).toBe(80);
    // TKT-22 — el profesor ve su curso en correctRate (100%) y el COLEGIO completo
    // en references.org (50%): la referencia trasciende el scope del usuario.
    expect(res.questions[0].correctRate).toBe(100);
    expect(res.questions[0].references.org).toBe(50);
  });

  it('filtro nodeId: limita las columnas a ítems taggeados con ese nodo', async () => {
    const db = makeDb([
      [assessmentRow], // requireAssessmentOwnedByUser
      itemRows, // loadQuestionColumns → items (admin, sin scope query)
      tagRows, // loadTagsByItems
      [{ itemId: ITEM_A }], // filtro nodeId → solo ITEM_A taggeado
      [{ itemId: ITEM_A, total: 2, correct: 1 }], // attachCorrectRates
      [{ total: 1 }], // count
      [
        {
          studentId: STUDENT_1,
          studentRut: '11.111.111-1',
          firstName: 'Ana',
          lastName: 'Soto',
          percentage: '50.00',
        },
      ],
      [
        // loadStudentClassGroups
        { studentId: STUDENT_1, classGroupId: CLASS_GROUP_ID, classGroupName: '3A' },
      ],
      [
        {
          studentId: STUDENT_1,
          itemId: ITEM_A,
          value: { answer: 'B' },
          isCorrect: true,
          finalScore: '1.00',
          rawScore: '1.00',
        },
      ],
    ]);
    const service = makeService(db);

    const res = await service.getMatrix(makeUser(), {
      assessmentId: ASSESSMENT_ID,
      nodeId: NODE_SKILL,
      page: 1,
      limit: 50,
      all: false,
    });
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].itemId).toBe(ITEM_A);
    // Las celdas también respetan una sola columna.
    expect(res.students.data[0].cells).toHaveLength(1);
  });

  it('TKT-12 filtro multi-tag OR: incluye ítems con CUALQUIERA de los tags', async () => {
    const db = makeDb([
      [assessmentRow], // requireAssessmentOwnedByUser
      itemRows, // loadQuestionColumns → items
      tagRows, // loadTagsByItems
      // filtro por nodos (nodeId ∪ tagIds): ambos ítems calzan con algún tag.
      [{ itemId: ITEM_A }, { itemId: ITEM_B }],
      [
        { itemId: ITEM_A, total: 2, correct: 1 },
        { itemId: ITEM_B, total: 2, correct: 2 },
      ], // attachCorrectRates
      [{ total: 1 }], // count
      [
        {
          studentId: STUDENT_1,
          studentRut: '11.111.111-1',
          firstName: 'Ana',
          lastName: 'Soto',
          percentage: '50.00',
        },
      ],
      [{ studentId: STUDENT_1, classGroupId: CLASS_GROUP_ID, classGroupName: '3A' }],
      [
        {
          studentId: STUDENT_1,
          itemId: ITEM_A,
          value: { answer: 'B' },
          isCorrect: true,
          finalScore: '1.00',
          rawScore: '1.00',
        },
      ],
    ]);
    const service = makeService(db);

    const res = await service.getMatrix(makeUser(), {
      assessmentId: ASSESSMENT_ID,
      tagIds: [NODE_SKILL, NODE_CONTENT],
      page: 1,
      limit: 50,
      all: false,
    });
    // OR: ambos ítems se mantienen porque cada uno tiene alguno de los tags.
    expect(res.questions.map((q) => q.itemId).sort()).toEqual([ITEM_A, ITEM_B].sort());
  });

  it('TKT-09 all=true: devuelve el curso completo sin paginar (page=1, limit=total)', async () => {
    const db = makeDb([
      [assessmentRow], // requireAssessmentOwnedByUser
      itemRows, // loadQuestionColumns → items
      tagRows, // loadTagsByItems
      [
        { itemId: ITEM_A, total: 2, correct: 1 },
        { itemId: ITEM_B, total: 2, correct: 2 },
      ], // attachCorrectRates
      [{ total: 2 }], // count
      [
        {
          studentId: STUDENT_1,
          studentRut: '11.111.111-1',
          firstName: 'Ana',
          lastName: 'Soto',
          percentage: '50.00',
        },
        {
          studentId: STUDENT_2,
          studentRut: '22.222.222-2',
          firstName: 'Beto',
          lastName: 'Vera',
          percentage: '80.00',
        },
      ], // loadStudentsPage → page (all → sin limit/offset)
      [
        { studentId: STUDENT_1, classGroupId: CLASS_GROUP_ID, classGroupName: '3A' },
        { studentId: STUDENT_2, classGroupId: CLASS_GROUP_ID, classGroupName: '3A' },
      ],
      [], // loadCells
    ]);
    const service = makeService(db);

    const res = await service.getMatrix(makeUser(), {
      assessmentId: ASSESSMENT_ID,
      page: 1,
      limit: 50,
      all: true,
    });
    expect(res.students.total).toBe(2);
    expect(res.students.data).toHaveLength(2);
    // Con all=true se reporta una sola página con todo el curso.
    expect(res.students.page).toBe(1);
    expect(res.students.limit).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getQuestionAnalysis (H6.12)
// ──────────────────────────────────────────────────────────────────────────────

describe('ItemAnalysisService.getQuestionAnalysis', () => {
  const itemVisibleRow = {
    id: ITEM_A,
    orgId: 'org-1',
    instrumentId: INSTRUMENT_ID,
    instrumentOrgId: 'org-1',
    position: 1,
    type: 'multiple_choice',
    content: {
      stem: 'Pregunta A',
      explanation: 'Porque B.',
      alternatives: [
        { key: 'A', text: 'Opción A' },
        { key: 'B', text: 'Opción B' },
      ],
      correctKey: 'B',
    },
  };

  it('distribuye respuestas por alternativa con blankCount y correctRate (admin)', async () => {
    const db = makeDb([
      // getAccessibleClassGroupIds → admin → sin query
      [itemVisibleRow], // requireItemVisible
      tagRows.filter((t) => t.itemId === ITEM_A), // loadItemTags (representativo)
      [
        // loadAllItemTags → TODOS los nodos asociados
        {
          nodeId: NODE_SKILL,
          nodeName: 'Localizar información',
          nodeType: 'skill',
          nodeCode: null,
          tagType: 'primary',
          taggedBy: 'human',
        },
        {
          nodeId: NODE_CONTENT,
          nodeName: 'OA 1',
          nodeType: 'content',
          nodeCode: 'OA 1',
          tagType: 'secondary',
          taggedBy: 'ai',
        },
      ],
      // resolveAccessibleClassGroupIds → null (puro, sin query)
      [
        // loadAnswerDistribution → filas del read-model de cohorte. Dos cursos:
        // se recombinan SUMANDO conteos por (key, isCorrect), nunca promediando %.
        {
          answerCounts: [
            { key: 'B', isCorrect: true, count: 4 },
            { key: 'A', isCorrect: false, count: 1 },
          ],
        },
        {
          answerCounts: [
            { key: 'B', isCorrect: true, count: 2 },
            { key: 'A', isCorrect: false, count: 2 },
            { key: null, isCorrect: false, count: 1 },
          ],
        },
      ],
    ]);
    const service = makeService(db);

    const res = await service.getQuestionAnalysis(makeUser(), ITEM_A, {});

    expect(res.itemId).toBe(ITEM_A);
    expect(res.stem).toBe('Pregunta A');
    expect(res.explanation).toBe('Porque B.');
    expect(res.correctKey).toBe('B');
    expect(res.totalResponses).toBe(10);
    expect(res.blankCount).toBe(1);
    expect(res.correctCount).toBe(6);
    expect(res.correctRate).toBe(60);

    // alternativas incluyen correcta + distractores con count/percentage.
    expect(res.alternatives).toHaveLength(2);
    const altB = res.alternatives.find((a) => a.key === 'B')!;
    expect(altB.isCorrect).toBe(true);
    expect(altB.count).toBe(6);
    expect(altB.percentage).toBe(60);
    const altA = res.alternatives.find((a) => a.key === 'A')!;
    expect(altA.isCorrect).toBe(false);
    expect(altA.count).toBe(3);
    expect(altA.percentage).toBe(30);
    // skill/content derivados.
    expect(res.skill?.nodeId).toBe(NODE_SKILL);
    // tags: TODOS los nodos asociados, con código/tagType/origen.
    expect(res.tags).toHaveLength(2);
    expect(res.tags.map((t) => t.nodeId)).toEqual([NODE_SKILL, NODE_CONTENT]);
    const contentTag = res.tags.find((t) => t.nodeId === NODE_CONTENT)!;
    expect(contentTag).toMatchObject({
      nodeCode: 'OA 1',
      nodeType: 'content',
      tagType: 'secondary',
      taggedBy: 'ai',
    });
  });

  // ⚠️ La regla central del read-model. Los cursos tienen N distinto, así que
  // recombinarlos es SUMA de conteos y el % se recalcula al final sobre el total.
  // Promediar los % de cada curso los ponderaría igual y daría otro número.
  it('recombina cohortes de distinto N sumando conteos, NO promediando porcentajes', async () => {
    const db = makeDb([
      [itemVisibleRow], // requireItemVisible
      [], // loadItemTags
      [], // loadAllItemTags
      [
        // Curso grande: 9 de 10 correctas → 90%.
        {
          answerCounts: [
            { key: 'B', isCorrect: true, count: 9 },
            { key: 'A', isCorrect: false, count: 1 },
          ],
        },
        // Curso chico: 0 de 2 correctas → 0%.
        { answerCounts: [{ key: 'A', isCorrect: false, count: 2 }] },
      ],
    ]);
    const service = makeService(db);

    const res = await service.getQuestionAnalysis(makeUser(), ITEM_A, {});

    // Suma de conteos: 9 correctas de 12 respuestas → 75%.
    // El promedio de los % por curso habría dado (90 + 0) / 2 = 45%.
    expect(res.totalResponses).toBe(12);
    expect(res.correctCount).toBe(9);
    expect(res.correctRate).toBe(75);
    const altA = res.alternatives.find((a) => a.key === 'A')!;
    expect(altA.count).toBe(3); // 1 + 2, sumados entre cohortes
    expect(altA.percentage).toBe(25); // sobre el total recombinado, no por curso
  });

  // El `isCorrect` presentable de la alternativa NO viene del read-model: la clave
  // derivada de items.content gana sobre el flag por alternativa. El isCorrect de
  // los buckets es el de la fila de respuesta y sólo alimenta correctCount.
  it('la correctKey derivada del contenido gana sobre el isCorrect de los buckets', async () => {
    const db = makeDb([
      [itemVisibleRow], // correctKey: 'B'
      [],
      [],
      [
        {
          answerCounts: [
            // Dato inconsistente a propósito: 'A' marcada como correcta en la fila.
            { key: 'A', isCorrect: true, count: 2 },
            { key: 'B', isCorrect: true, count: 8 },
          ],
        },
      ],
    ]);
    const service = makeService(db);

    const res = await service.getQuestionAnalysis(makeUser(), ITEM_A, {});
    // La presentación sigue content.correctKey = 'B'.
    expect(res.alternatives.find((a) => a.key === 'A')!.isCorrect).toBe(false);
    expect(res.alternatives.find((a) => a.key === 'B')!.isCorrect).toBe(true);
    // …pero correctCount respeta el bucket, igual que el coalesce(is_correct) viejo.
    expect(res.correctCount).toBe(10);
  });

  // El assessmentId es opcional: el ítem se agrega across assessments sumando las
  // filas del read-model de varios assessments.
  it('sin assessmentId agrega el ítem across assessments (suma de filas)', async () => {
    const db = makeDb([
      [itemVisibleRow], // requireItemVisible
      [], // loadItemTags
      [], // loadAllItemTags
      [
        // Misma pregunta, dos evaluaciones distintas.
        { answerCounts: [{ key: 'B', isCorrect: true, count: 3 }] },
        {
          answerCounts: [
            { key: 'B', isCorrect: true, count: 1 },
            { key: 'A', isCorrect: false, count: 4 },
          ],
        },
      ],
    ]);
    const service = makeService(db);

    const res = await service.getQuestionAnalysis(makeUser(), ITEM_A, {});
    expect(res.totalResponses).toBe(8);
    expect(res.correctCount).toBe(4);
    expect(res.correctRate).toBe(50);
  });

  it('lanza NotFound si el ítem no es visible para la org', async () => {
    const db = makeDb([
      // admin → sin scope query
      [], // requireItemVisible → vacío
    ]);
    const service = makeService(db);
    await expect(service.getQuestionAnalysis(makeUser(), ITEM_A, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // Regresión: los instrumentos oficiales (ej. DIA) tienen org_id NULL. El detalle
  // de pregunta DEBE resolverlos (la matriz ya los muestra); antes los rechazaba
  // con "Pregunta no encontrada" porque exigía org exacta (itemOrg === orgId).
  it('resuelve una pregunta de instrumento OFICIAL (org_id NULL) sin lanzar', async () => {
    const officialRow = {
      id: ITEM_A,
      orgId: null,
      instrumentId: INSTRUMENT_ID,
      instrumentOrgId: null,
      position: 1,
      type: 'multiple_choice',
      content: {
        stem: 'Pregunta oficial',
        alternatives: [
          { key: 'A', text: 'Opción A' },
          { key: 'B', text: 'Opción B' },
        ],
        correctKey: 'B',
      },
    };
    const db = makeDb([
      [officialRow], // requireItemVisible → oficial (org null)
      [], // loadItemTags
      [], // loadAllItemTags
      [{ answerCounts: [{ key: 'B', isCorrect: true, count: 5 }] }], // loadAnswerDistribution
    ]);
    const service = makeService(db);

    const res = await service.getQuestionAnalysis(makeUser(), ITEM_A, {});
    expect(res.itemId).toBe(ITEM_A);
    expect(res.stem).toBe('Pregunta oficial');
  });

  // El fix NO debe abrir visibilidad de más: un ítem de OTRA org sigue oculto.
  it('lanza NotFound si el ítem pertenece a OTRA org', async () => {
    const otherOrgRow = {
      id: ITEM_A,
      orgId: 'org-OTRA',
      instrumentId: INSTRUMENT_ID,
      instrumentOrgId: 'org-OTRA',
      position: 1,
      type: 'multiple_choice',
      content: { stem: 'x', alternatives: [], correctKey: null },
    };
    const db = makeDb([[otherOrgRow]]); // requireItemVisible → org ajena
    const service = makeService(db);
    await expect(service.getQuestionAnalysis(makeUser(), ITEM_A, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('ítem no de selección múltiple → alternatives vacías pero conserva totales', async () => {
    const openItem = {
      id: ITEM_B,
      orgId: 'org-1',
      instrumentId: INSTRUMENT_ID,
      instrumentOrgId: 'org-1',
      position: 2,
      type: 'open_ended',
      content: { stem: 'Desarrolle su respuesta.' }, // sin alternatives
    };
    const db = makeDb([
      [openItem], // requireItemVisible
      [], // loadItemTags → sin tags
      [], // loadAllItemTags → sin nodos
      [
        {
          answerCounts: [
            { key: null, isCorrect: false, count: 4 },
            { key: null, isCorrect: true, count: 1 },
          ],
        },
      ], // loadAnswerDistribution
    ]);
    const service = makeService(db);

    const res = await service.getQuestionAnalysis(makeUser(), ITEM_B, {});
    expect(res.alternatives).toEqual([]);
    expect(res.totalResponses).toBe(5);
    expect(res.correctCount).toBe(1);
    expect(res.correctRate).toBe(20);
    expect(res.skill).toBeNull();
    expect(res.content).toBeNull();
    expect(res.tags).toEqual([]);
  });

  it('deriva correctKey desde alternatives[].isCorrect cuando falta correctKey', async () => {
    const itemNoKey = {
      id: ITEM_B,
      orgId: 'org-1',
      instrumentId: INSTRUMENT_ID,
      instrumentOrgId: 'org-1',
      position: 2,
      type: 'multiple_choice',
      content: {
        stem: 'Pregunta sin correctKey',
        alternatives: [
          { key: 'A', text: 'Opción A', isCorrect: true },
          { key: 'B', text: 'Opción B' },
        ],
      },
    };
    const db = makeDb([
      [itemNoKey], // requireItemVisible
      [], // loadItemTags
      [], // loadAllItemTags
      [
        {
          answerCounts: [
            { key: 'A', isCorrect: true, count: 5 },
            { key: 'B', isCorrect: false, count: 5 },
          ],
        },
      ], // loadAnswerDistribution
    ]);
    const service = makeService(db);

    const res = await service.getQuestionAnalysis(makeUser(), ITEM_B, {});
    expect(res.correctKey).toBe('A');
    const altA = res.alternatives.find((a) => a.key === 'A')!;
    expect(altA.isCorrect).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// listAssessments (selector de la tabla cruzada)
// ──────────────────────────────────────────────────────────────────────────────

describe('ItemAnalysisService.listAssessments', () => {
  it('admin: lista evaluaciones con studentsCount mergeado y ordenadas', async () => {
    const db = makeDb([
      // rows: evaluaciones con resultados (admin → sin query de scope previa)
      [
        {
          assessmentId: ASSESSMENT_ID,
          name: 'DIA Lectura',
          administeredAt: new Date('2026-03-10T00:00:00Z'),
          instrumentName: 'Instrumento Lectura',
          instrumentType: 'dia',
          subjectName: 'Lenguaje',
          gradeName: '3° básico',
        },
      ],
      // countRows: count(distinct studentId) por evaluación
      [{ assessmentId: ASSESSMENT_ID, count: 24 }],
    ]);
    const service = makeService(db);

    const res = await service.listAssessments(makeUser(), {});
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({
      assessmentId: ASSESSMENT_ID,
      name: 'DIA Lectura',
      instrumentName: 'Instrumento Lectura',
      instrumentType: 'dia',
      subjectName: 'Lenguaje',
      gradeName: '3° básico',
      studentsCount: 24,
    });
  });

  it('admin: sin evaluaciones con resultados → data vacía (sin segunda query)', async () => {
    const db = makeDb([[]]); // rows vacío → no se consulta countRows
    const service = makeService(db);
    const res = await service.listAssessments(makeUser(), {});
    expect(res.data).toEqual([]);
  });

  it('profesor sin cursos asignados → data vacía', async () => {
    const db = makeDb([
      [], // getAccessibleClassGroupIds → profesor sin class_groups
    ]);
    const service = makeService(db);
    const res = await service.listAssessments(makeUser({ role: 'teacher' }), {});
    expect(res.data).toEqual([]);
  });

  it('profesor con cursos: acota studentsCount a sus alumnos', async () => {
    const db = makeDb([
      [{ classGroupId: CLASS_GROUP_ID }], // getAccessibleClassGroupIds
      [
        {
          assessmentId: ASSESSMENT_ID,
          name: 'DIA Lectura',
          administeredAt: new Date('2026-03-10T00:00:00Z'),
          instrumentName: 'Instrumento Lectura',
          instrumentType: 'dia',
          subjectName: 'Lenguaje',
          gradeName: '3° básico',
        },
      ], // rows
      [{ studentId: STUDENT_1 }, { studentId: STUDENT_2 }], // scopedStudentIds (enrollments)
      [{ assessmentId: ASSESSMENT_ID, count: 2 }], // countRows acotado
    ]);
    const service = makeService(db);

    const res = await service.listAssessments(makeUser({ role: 'teacher' }), {});
    expect(res.data).toHaveLength(1);
    expect(res.data[0].studentsCount).toBe(2);
  });

  // Un informe oficial cargado en modo agregado no tiene filas por alumno: su N vive
  // en el read-model de cohorte. La lista ya mostraba estas evaluaciones, pero con
  // "0 alumnos" mientras su propio hub mostraba la asistencia correcta.
  it('evaluación agregada (sin filas por alumno): toma el N del read-model de cohorte', async () => {
    const db = makeDb([
      [
        {
          assessmentId: ASSESSMENT_ID,
          name: 'LANG diagnóstico 2025',
          administeredAt: new Date('2026-03-10T00:00:00Z'),
          instrumentName: 'DIA Lenguaje',
          instrumentType: 'dia',
          subjectName: 'Lenguaje',
          gradeName: '3° básico',
        },
      ], // rows
      [], // countRows: sin assessment_results
      // cohorte: grano (assessment × curso); el N del scope es la SUMA de los max
      [
        { assessmentId: ASSESSMENT_ID, scoreSum: '600', maxSum: '1000', studentsAssessed: 41 },
        { assessmentId: ASSESSMENT_ID, scoreSum: '300', maxSum: '500', studentsAssessed: 2 },
      ],
    ]);
    const service = makeService(db);

    const res = await service.listAssessments(makeUser(), {});
    expect(res.data[0].studentsCount).toBe(43);
  });

  it('con ambas fuentes: manda el dato por alumno', async () => {
    const db = makeDb([
      [
        {
          assessmentId: ASSESSMENT_ID,
          name: 'DIA Lectura',
          administeredAt: new Date('2026-03-10T00:00:00Z'),
          instrumentName: 'Instrumento Lectura',
          instrumentType: 'dia',
          subjectName: 'Lenguaje',
          gradeName: '3° básico',
        },
      ],
      [{ assessmentId: ASSESSMENT_ID, count: 40 }], // countRows
      [{ assessmentId: ASSESSMENT_ID, scoreSum: '1', maxSum: '2', studentsAssessed: 999 }],
    ]);
    const service = makeService(db);

    const res = await service.listAssessments(makeUser(), {});
    expect(res.data[0].studentsCount).toBe(40);
  });
});
