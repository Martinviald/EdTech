import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getTableName } from 'drizzle-orm';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { Database } from '../database/database.types';
import { AnswerSheetsService } from './answer-sheets.service';
import { AnswerSheetPreviewStore } from './lib/preview-store';

/**
 * Tests del AnswerSheetsService usando mocks del Database. No requieren
 * PostgreSQL — se enfocan en la lógica de orquestación: parseo, store,
 * multi-tenancy, error handling y wiring del calculador puro.
 */

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000001';
const INSTRUMENT_ID = 'cccccccc-0000-0000-0000-000000000001';
const ASSESSMENT_ID = 'dddddddd-0000-0000-0000-000000000001';
const USER_A_ID = 'eeeeeeee-0000-0000-0000-000000000001';
const ITEM_1 = 'ffff0001-0000-0000-0000-000000000001';
const ITEM_2 = 'ffff0002-0000-0000-0000-000000000001';
const ITEM_3 = 'ffff0003-0000-0000-0000-000000000001';
const STUDENT_1 = '11110000-0000-0000-0000-000000000001';
const NODE_1 = '22220000-0000-0000-0000-000000000001';
const JOB_ID = '99990000-0000-0000-0000-000000000001';
const CLASS_GROUP_1 = '33330000-0000-0000-0000-000000000001';

/** Alternativas A–D como las guarda la BDD real, con `isCorrect` en la clave dada. */
function mcqAlternatives(correctKey: string) {
  return ['A', 'B', 'C', 'D'].map((key) => ({
    key,
    text: `Alternativa ${key}`,
    isCorrect: key === correctKey,
  }));
}

function makeJwt(orgId: string | null = ORG_A, userId = USER_A_ID): JwtPayload {
  return {
    userId,
    orgId,
    email: 'test@example.com',
    name: 'Test User',
    isPlatformAdmin: false,
    roles: ['school_admin'],
    activeRole: 'school_admin',
    role: 'school_admin',
  };
}

// Mock de Database basado en stubs que devuelven distintos resultados por tabla.
function buildMockDb(plan: {
  instrumentRow?: {
    id: string;
    orgId: string | null;
    gradingScaleId: string | null;
  } | null;
  itemRows?: Array<{
    id: string;
    position: number;
    type?: string;
    content: Record<string, unknown>;
    scoringConfig: Record<string, unknown>;
  }>;
  taxonomyTags?: Array<{ itemId: string; nodeId: string }>;
  studentRows?: Array<{
    id: string;
    rut: string;
    firstName: string;
    lastName: string;
  }>;
  gradingScaleRow?: {
    type: string;
    minGrade: string;
    maxGrade: string;
    passingGrade: string;
    passingThreshold: string;
    config: Record<string, unknown>;
  } | null;
  jobRow?: {
    id: string;
    orgId: string;
    assessmentId: string | null;
    type: string;
    status: string;
    fileUrl: string | null;
    mappingConfig: Record<string, unknown> | null;
    result: { rowsProcessed?: number; errors?: number; warnings?: number } | null;
    errorLog: Array<{ row: number; message: string }> | null;
    createdById: string | null;
    createdAt: Date;
    completedAt: Date | null;
  } | null;
  assessmentRow?: {
    id: string;
    orgId: string;
    dataGranularity?: 'item_level' | 'aggregate_only';
  } | null;
  enrollmentRows?: Array<{ studentId: string; classGroupId: string }>;
}) {
  type Where = unknown;

  let lastFromTable: string | null = null;

  const detectTable = (table: unknown): string => {
    try {
      // Drizzle expone el nombre de tabla vía getTableName().
      return getTableName(table as Parameters<typeof getTableName>[0]);
    } catch {
      return String(table);
    }
  };

  const resolveForTable = (name: string | null): Promise<unknown[]> => {
    if (name === 'instruments') {
      return Promise.resolve(plan.instrumentRow ? [plan.instrumentRow] : []);
    }
    if (name === 'items') {
      return Promise.resolve(plan.itemRows ?? []);
    }
    if (name === 'item_taxonomy_tags') {
      return Promise.resolve(plan.taxonomyTags ?? []);
    }
    if (name === 'students') {
      return Promise.resolve(plan.studentRows ?? []);
    }
    if (name === 'grading_scales') {
      return Promise.resolve(plan.gradingScaleRow ? [plan.gradingScaleRow] : []);
    }
    if (name === 'import_jobs') {
      return Promise.resolve(plan.jobRow ? [plan.jobRow] : []);
    }
    if (name === 'assessments') {
      return Promise.resolve(plan.assessmentRow ? [plan.assessmentRow] : []);
    }
    if (name === 'student_enrollments') {
      return Promise.resolve(plan.enrollmentRows ?? []);
    }
    return Promise.resolve([]);
  };

  const buildWhereChain = (name: string | null) => ({
    // Soporta `.where(...).orderBy(...)` también como thenable directo.
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      resolveForTable(name).then(resolve, reject),
    orderBy: (..._args: unknown[]) => resolveForTable(name),
  });

  const selectChain = (table: unknown) => {
    lastFromTable = detectTable(table);
    // El nombre se captura acá y no se lee de `lastFromTable` al resolver: el
    // read-model de cohorte encadena joins y una segunda query podría pisarlo.
    const name = lastFromTable;
    const chain = {
      innerJoin: (..._args: unknown[]) => chain,
      leftJoin: (..._args: unknown[]) => chain,
      where: (_w: Where) => buildWhereChain(name),
      orderBy: (..._args: unknown[]) => resolveForTable(name),
    };
    return chain;
  };

  const insertChain = () => ({
    values: (_values: unknown) => ({
      returning: () =>
        Promise.resolve([
          { id: ASSESSMENT_ID, ...({} as Record<string, unknown>) },
        ]),
      onConflictDoUpdate: () => Promise.resolve(undefined),
    }),
  });

  const deleteChain = () => ({
    where: () => Promise.resolve(undefined),
  });

  const txDb = {
    // withOrgContext() ejecuta set_config vía tx.execute antes del callback.
    execute: async () => [],
    select: (cols?: unknown) => ({
      from: (table: unknown) => {
        if (cols !== undefined) {
          // Algunos call sites usan select({...}).from(table).where()
          return selectChain(table);
        }
        return selectChain(table);
      },
    }),
    insert: (table: unknown) => {
      // El returning depende de la tabla
      const tableName = detectTable(table);
      return {
        values: (_values: unknown) => ({
          returning: () => {
            if (tableName === 'assessments') {
              return Promise.resolve([{ id: ASSESSMENT_ID }]);
            }
            if (tableName === 'import_jobs') {
              return Promise.resolve([{ id: JOB_ID }]);
            }
            return Promise.resolve([{ id: 'unknown' }]);
          },
          onConflictDoUpdate: () => Promise.resolve(undefined),
        }),
      };
    },
    delete: deleteChain,
  };

  const db = {
    select: (_cols?: unknown) => ({
      from: (table: unknown) => selectChain(table),
    }),
    insert: insertChain,
    delete: deleteChain,
    transaction: async (cb: (tx: Database) => Promise<unknown>) => {
      return cb(txDb as unknown as Database);
    },
  };

  return db as unknown as Database;
}

// Mock que captura los `values()` insertados en `responses` y `assessment_results`,
// con un instrumento de 3 ítems (2 MCQ + 1 open_ended) para verificar el scoring
// por estrategia end-to-end. Reusa el detector de tabla de Drizzle.
function buildCapturingDb(captured: {
  responses: unknown[][];
  assessmentResults: unknown[][];
  itemStats?: unknown[][];
  skillStats?: unknown[][];
  deletedTables?: string[];
}): Database {
  const detect = (table: unknown): string => {
    try {
      return getTableName(table as Parameters<typeof getTableName>[0]);
    } catch {
      return String(table);
    }
  };

  // `alternatives` no es decorativo: de ahí sale `hasAlternatives`, que distingue un
  // MCQ en blanco de un ítem de desarrollo en el read-model. En la BDD real el 100%
  // de los multiple_choice lo trae y ningún open_ended lo tiene.
  const itemRows = [
    { id: ITEM_1, position: 1, type: 'multiple_choice', content: { correctKey: 'A', alternatives: mcqAlternatives('A') }, scoringConfig: { points: 1 } },
    { id: ITEM_2, position: 2, type: 'multiple_choice', content: { correctKey: 'B', alternatives: mcqAlternatives('B') }, scoringConfig: { points: 1 } },
    { id: ITEM_3, position: 3, type: 'open_ended', content: { prompt: 'Explica...' }, scoringConfig: { points: 1 } },
  ];
  const studentRows = [
    { id: STUDENT_1, rut: '12345678-5', firstName: 'Juan', lastName: 'Pérez' },
  ];

  const rowsFor = (name: string): unknown[] => {
    if (name === 'instruments') return [{ id: INSTRUMENT_ID, orgId: ORG_A, gradingScaleId: null }];
    if (name === 'items') return itemRows;
    if (name === 'item_taxonomy_tags') return [{ itemId: ITEM_1, nodeId: NODE_1 }];
    if (name === 'students') return studentRows;
    if (name === 'grading_scales') return [];
    if (name === 'student_enrollments') {
      return [{ studentId: STUDENT_1, classGroupId: CLASS_GROUP_1 }];
    }
    return [];
  };

  const whereChain = (name: string) => ({
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rowsFor(name)).then(resolve, reject),
    orderBy: () => Promise.resolve(rowsFor(name)),
  });
  const selectChain = (table: unknown) => {
    const name = detect(table);
    const chain = {
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => whereChain(name),
      orderBy: () => Promise.resolve(rowsFor(name)),
    };
    return chain;
  };

  const insertFor = (table: unknown) => {
    const name = detect(table);
    return {
      values: (values: unknown) => {
        const arr = Array.isArray(values) ? values : [values];
        if (name === 'responses') captured.responses.push(arr);
        if (name === 'assessment_results') captured.assessmentResults.push(arr);
        if (name === 'assessment_item_stats') captured.itemStats?.push(arr);
        if (name === 'assessment_skill_stats') captured.skillStats?.push(arr);
        return {
          returning: () => {
            if (name === 'assessments') return Promise.resolve([{ id: ASSESSMENT_ID }]);
            if (name === 'import_jobs') return Promise.resolve([{ id: JOB_ID }]);
            return Promise.resolve([{ id: 'unknown' }]);
          },
          onConflictDoUpdate: () => Promise.resolve(undefined),
        };
      },
    };
  };

  const deleteFor = (table: unknown) => {
    captured.deletedTables?.push(detect(table));
    return { where: () => Promise.resolve(undefined) };
  };

  const tx = {
    // withOrgContext() fija app.current_org_id vía tx.execute antes del callback.
    execute: async () => [],
    select: () => ({ from: (table: unknown) => selectChain(table) }),
    insert: (table: unknown) => insertFor(table),
    delete: (table: unknown) => deleteFor(table),
  };

  const db = {
    select: () => ({ from: (table: unknown) => selectChain(table) }),
    insert: (table: unknown) => insertFor(table),
    delete: (table: unknown) => deleteFor(table),
    transaction: async (cb: (t: Database) => Promise<unknown>) =>
      cb(tx as unknown as Database),
  };
  return db as unknown as Database;
}

describe('AnswerSheetsService', () => {
  let store: AnswerSheetPreviewStore;

  beforeEach(() => {
    store = new AnswerSheetPreviewStore();
  });

  const gradecamCsv = Buffer.from(
    `Student ID,First Name,Last Name,Q1,Q2,Q3\n12345678-5,Juan,Pérez,A,B,C\n9876543-3,María,González,B,B,C\n`,
  );

  describe('upload', () => {
    it('parsea gradecam CSV y devuelve previewToken + totalRows', async () => {
      const db = buildMockDb({
        instrumentRow: { id: INSTRUMENT_ID, orgId: ORG_A, gradingScaleId: null },
      });
      const service = new AnswerSheetsService(db, store);

      const result = await service.upload(
        makeJwt(),
        { buffer: gradecamCsv, originalname: 'gradecam.csv' },
        { format: 'gradecam_csv', instrumentId: INSTRUMENT_ID },
      );

      expect(result.previewToken).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
      expect(result.format).toBe('gradecam_csv');
      expect(result.totalRows).toBe(2);
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('rechaza si el instrumento no existe o no es visible para la org', async () => {
      const db = buildMockDb({ instrumentRow: null });
      const service = new AnswerSheetsService(db, store);

      await expect(
        service.upload(
          makeJwt(),
          { buffer: gradecamCsv, originalname: 'g.csv' },
          { format: 'gradecam_csv', instrumentId: INSTRUMENT_ID },
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza si generic_csv viene sin columnMapping', async () => {
      const db = buildMockDb({
        instrumentRow: { id: INSTRUMENT_ID, orgId: ORG_A, gradingScaleId: null },
      });
      const service = new AnswerSheetsService(db, store);

      await expect(
        service.upload(
          makeJwt(),
          { buffer: gradecamCsv, originalname: 'g.csv' },
          { format: 'generic_csv', instrumentId: INSTRUMENT_ID },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza si el usuario no tiene orgId activo', async () => {
      const db = buildMockDb({});
      const service = new AnswerSheetsService(db, store);
      await expect(
        service.upload(
          makeJwt(null),
          { buffer: gradecamCsv, originalname: 'g.csv' },
          { format: 'gradecam_csv', instrumentId: INSTRUMENT_ID },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('preview', () => {
    it('devuelve filas con matched/unmatched students', async () => {
      const db = buildMockDb({
        instrumentRow: { id: INSTRUMENT_ID, orgId: ORG_A, gradingScaleId: null },
        itemRows: [
          {
            id: ITEM_1,
            position: 1,
            type: 'multiple_choice',
            content: { correctKey: 'A', alternatives: mcqAlternatives('A') },
            scoringConfig: { points: 1 },
          },
          {
            id: ITEM_2,
            position: 2,
            type: 'multiple_choice',
            content: { correctKey: 'B', alternatives: mcqAlternatives('B') },
            scoringConfig: { points: 1 },
          },
        ],
        // Sólo "Juan" existe en la BD.
        studentRows: [
          { id: STUDENT_1, rut: '12345678-5', firstName: 'Juan', lastName: 'Pérez' },
        ],
      });
      const service = new AnswerSheetsService(db, store);

      const upload = await service.upload(
        makeJwt(),
        { buffer: gradecamCsv, originalname: 'g.csv' },
        { format: 'gradecam_csv', instrumentId: INSTRUMENT_ID },
      );

      const preview = await service.preview(makeJwt(), upload.previewToken);
      expect(preview.summary.totalRows).toBe(2);
      expect(preview.summary.matchedStudents).toBe(1);
      expect(preview.summary.unmatchedStudents).toBe(1);
      // El CSV trae respuestas para 3 posiciones (1, 2, 3) y el instrumento tiene 2 ítems
      expect(preview.summary.itemsCovered).toBe(3);
      expect(preview.summary.itemsInInstrument).toBe(2);
    });

    it('rechaza con 404 si el previewToken no existe', async () => {
      const db = buildMockDb({});
      const service = new AnswerSheetsService(db, store);
      await expect(
        service.preview(makeJwt(), '00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza con 403 si otro tenant intenta leer el token', async () => {
      const db = buildMockDb({
        instrumentRow: { id: INSTRUMENT_ID, orgId: ORG_A, gradingScaleId: null },
        itemRows: [],
        studentRows: [],
      });
      const service = new AnswerSheetsService(db, store);

      const upload = await service.upload(
        makeJwt(ORG_A),
        { buffer: gradecamCsv, originalname: 'g.csv' },
        { format: 'gradecam_csv', instrumentId: INSTRUMENT_ID },
      );

      // ORG_B intenta leer un token de ORG_A.
      // Volvemos a montar un mock para ORG_B (la query del instrumento ahora retorna otro row).
      const dbB = buildMockDb({
        instrumentRow: { id: INSTRUMENT_ID, orgId: ORG_B, gradingScaleId: null },
      });
      const serviceB = new AnswerSheetsService(dbB, store);
      await expect(
        serviceB.preview(makeJwt(ORG_B), upload.previewToken),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('confirm', () => {
    function setupConfirmDb(opts: { instrumentOrgId?: string | null } = {}) {
      return buildMockDb({
        instrumentRow: {
          id: INSTRUMENT_ID,
          orgId: opts.instrumentOrgId ?? ORG_A,
          gradingScaleId: null,
        },
        itemRows: [
          {
            id: ITEM_1,
            position: 1,
            type: 'multiple_choice',
            content: { correctKey: 'A', alternatives: mcqAlternatives('A') },
            scoringConfig: { points: 1 },
          },
          {
            id: ITEM_2,
            position: 2,
            type: 'multiple_choice',
            content: { correctKey: 'B', alternatives: mcqAlternatives('B') },
            scoringConfig: { points: 1 },
          },
        ],
        taxonomyTags: [{ itemId: ITEM_1, nodeId: NODE_1 }],
        studentRows: [
          { id: STUDENT_1, rut: '12345678-5', firstName: 'Juan', lastName: 'Pérez' },
        ],
        enrollmentRows: [{ studentId: STUDENT_1, classGroupId: CLASS_GROUP_1 }],
      });
    }

    it('crea responses + import_job en una transacción', async () => {
      const db = setupConfirmDb();
      const service = new AnswerSheetsService(db, store);

      const upload = await service.upload(
        makeJwt(),
        { buffer: gradecamCsv, originalname: 'g.csv' },
        { format: 'gradecam_csv', instrumentId: INSTRUMENT_ID },
      );

      const result = await service.confirm(makeJwt(), {
        previewToken: upload.previewToken,
        createAssessment: true,
        skipErrorRows: true,
      });

      expect(result.jobId).toBe(JOB_ID);
      expect(result.assessmentId).toBe(ASSESSMENT_ID);
      // 1 alumno matcheado × 2 items del instrumento = 2 responses
      expect(result.responsesCreated).toBe(2);
      expect(result.studentsProcessed).toBe(1);
      expect(['completed', 'partial']).toContain(result.status);
    });

    it('puntúa MCQ por estrategia y NO contamina el % con un ítem open_ended pendiente', async () => {
      // Instrumento: ítem 1 MCQ (clave A), ítem 2 MCQ (clave B), ítem 3 open_ended.
      // El alumno responde A, B y "texto libre". Esperado:
      //  - Q1 y Q2 correctos (auto) → % autocorregido = 100%.
      //  - Q3 (open_ended) → pendiente: isCorrect null, scoredBy human, sin score.
      //  - El % del alumno NO baja por Q3 (excluido del denominador).
      const captured = {
        responses: [] as unknown[][],
        assessmentResults: [] as unknown[][],
      };
      const db = buildCapturingDb(captured);
      const service = new AnswerSheetsService(db, store);

      const csv = Buffer.from(
        `Student ID,First Name,Last Name,Q1,Q2,Q3\n12345678-5,Juan,Pérez,A,B,respuesta libre del alumno\n`,
      );
      const upload = await service.upload(
        makeJwt(),
        { buffer: csv, originalname: 'mixed.csv' },
        { format: 'gradecam_csv', instrumentId: INSTRUMENT_ID },
      );
      const result = await service.confirm(makeJwt(), {
        previewToken: upload.previewToken,
        createAssessment: true,
        skipErrorRows: true,
      });

      // 1 alumno × 3 items = 3 responses.
      expect(result.responsesCreated).toBe(3);

      const insertedResponses = captured.responses.flat() as Array<{
        itemId: string;
        isCorrect: boolean | null;
        scoredBy: string | null;
        finalScore: string | null;
        rawScore: string | null;
      }>;
      const byItem = new Map(insertedResponses.map((r) => [r.itemId, r]));

      // MCQ auto-scored.
      expect(byItem.get(ITEM_1)).toMatchObject({ isCorrect: true, scoredBy: 'auto' });
      expect(byItem.get(ITEM_2)).toMatchObject({ isCorrect: true, scoredBy: 'auto' });
      // open_ended pendiente: NUNCA 0/incorrecto.
      const openEnded = byItem.get(ITEM_3)!;
      expect(openEnded.isCorrect).toBeNull();
      expect(openEnded.scoredBy).toBe('human');
      expect(openEnded.finalScore).toBeNull();
      expect(openEnded.rawScore).toBeNull();

      // Resultado del alumno: % = 100% (2/2 MCQ), NO 66% — el open_ended no
      // contamina el denominador. `isComplete` false porque hay pendiente.
      const studentResult = (captured.assessmentResults.flat() as Array<{
        studentId: string;
        percentage: string;
        isComplete: boolean;
      }>)[0]!;
      expect(Number(studentResult.percentage)).toBeCloseTo(100, 5);
      expect(studentResult.isComplete).toBe(false);
    });

    // El fork inline que este service tenía NO pasaba por computeAndPersist. Si el
    // read-model sólo se poblara allá, ingestar una hoja lo dejaría desincronizado y
    // silenciosamente falso (plan §8.1). Estos tests fijan que la ingesta lo escribe.
    it('puebla el read-model de cohorte (assessment_item_stats + assessment_skill_stats)', async () => {
      const captured = {
        responses: [] as unknown[][],
        assessmentResults: [] as unknown[][],
        itemStats: [] as unknown[][],
        skillStats: [] as unknown[][],
        deletedTables: [] as string[],
      };
      const db = buildCapturingDb(captured);
      const service = new AnswerSheetsService(db, store);

      const csv = Buffer.from(
        `Student ID,First Name,Last Name,Q1,Q2,Q3\n12345678-5,Juan,Pérez,A,B,respuesta libre del alumno\n`,
      );
      const upload = await service.upload(
        makeJwt(),
        { buffer: csv, originalname: 'mixed.csv' },
        { format: 'gradecam_csv', instrumentId: INSTRUMENT_ID },
      );
      await service.confirm(makeJwt(), {
        previewToken: upload.previewToken,
        createAssessment: true,
        skipErrorRows: true,
      });

      // Delete + reinsert idempotente de las 4 tablas de resultados.
      expect(captured.deletedTables).toEqual(
        expect.arrayContaining([
          'assessment_results',
          'skill_results',
          'assessment_item_stats',
          'assessment_skill_stats',
        ]),
      );

      const itemStats = captured.itemStats.flat() as Array<{
        classGroupId: string;
        itemId: string;
        studentCount: number;
        responseCount: number;
        correctCount: number;
        answerCounts: Array<{ key: string | null; count: number; isCorrect: boolean }>;
        scoreSum: string;
        maxSum: string;
        source: string;
      }>;
      // 1 curso × 3 ítems del instrumento.
      expect(itemStats).toHaveLength(3);
      expect(itemStats.every((s) => s.classGroupId === CLASS_GROUP_1)).toBe(true);
      expect(itemStats.every((s) => s.source === 'computed')).toBe(true);

      const byItem = new Map(itemStats.map((s) => [s.itemId, s]));
      expect(byItem.get(ITEM_1)).toMatchObject({
        studentCount: 1,
        responseCount: 1,
        correctCount: 1,
        answerCounts: [{ key: 'A', count: 1, isCorrect: true }],
      });

      // El ítem pendiente (open_ended) SÍ entra al read-model: éste espeja el
      // `GROUP BY` sobre `responses`, que no filtra por isCorrect. El filtro de
      // `isCorrect !== null` es exclusivo del total por alumno.
      const pending = byItem.get(ITEM_3)!;
      expect(pending.responseCount).toBe(1);
      expect(pending.correctCount).toBe(0);
      // Sin alternativas → se bucketiza por puntaje (RC/RPC/RI), no por el texto
      // marcado. Como está pendiente de corrección no tiene score, así que cae en el
      // bucket `null` = "N — no responde", igual que el informe oficial.
      expect(pending.answerCounts).toEqual([{ key: null, count: 1, isCorrect: false }]);

      const skillStats = captured.skillStats.flat() as Array<{
        classGroupId: string;
        nodeId: string;
        source: string;
      }>;
      expect(skillStats).toHaveLength(1);
      expect(skillStats[0]).toMatchObject({
        classGroupId: CLASS_GROUP_1,
        nodeId: NODE_1,
        source: 'computed',
      });
    });

    it('rechaza con 409 ingestar contra un assessment aggregate_only', async () => {
      const db = buildMockDb({
        instrumentRow: { id: INSTRUMENT_ID, orgId: ORG_A, gradingScaleId: null },
        itemRows: [
          {
            id: ITEM_1,
            position: 1,
            type: 'multiple_choice',
            content: { correctKey: 'A', alternatives: mcqAlternatives('A') },
            scoringConfig: { points: 1 },
          },
        ],
        studentRows: [
          { id: STUDENT_1, rut: '12345678-5', firstName: 'Juan', lastName: 'Pérez' },
        ],
        assessmentRow: {
          id: ASSESSMENT_ID,
          orgId: ORG_A,
          dataGranularity: 'aggregate_only',
        },
      });
      const service = new AnswerSheetsService(db, store);

      const upload = await service.upload(
        makeJwt(),
        { buffer: gradecamCsv, originalname: 'g.csv' },
        { format: 'gradecam_csv', instrumentId: INSTRUMENT_ID },
      );

      await expect(
        service.confirm(makeJwt(), {
          previewToken: upload.previewToken,
          assessmentId: ASSESSMENT_ID,
          createAssessment: false,
          skipErrorRows: true,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rechaza si el previewToken expiró/no existe', async () => {
      const db = setupConfirmDb();
      const service = new AnswerSheetsService(db, store);
      await expect(
        service.confirm(makeJwt(), {
          previewToken: '00000000-0000-0000-0000-000000000000',
          createAssessment: true,
          skipErrorRows: true,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza con 403 si otro tenant intenta confirmar el token', async () => {
      const db = setupConfirmDb({ instrumentOrgId: ORG_A });
      const service = new AnswerSheetsService(db, store);
      const upload = await service.upload(
        makeJwt(ORG_A),
        { buffer: gradecamCsv, originalname: 'g.csv' },
        { format: 'gradecam_csv', instrumentId: INSTRUMENT_ID },
      );

      // ORG_B intenta confirmar.
      const dbB = setupConfirmDb({ instrumentOrgId: ORG_B });
      const serviceB = new AnswerSheetsService(dbB, store);
      await expect(
        serviceB.confirm(makeJwt(ORG_B), {
          previewToken: upload.previewToken,
          createAssessment: true,
          skipErrorRows: true,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getJob', () => {
    it('devuelve el job filtrado por org_id del caller', async () => {
      const createdAt = new Date('2026-01-01T00:00:00Z');
      const db = buildMockDb({
        jobRow: {
          id: JOB_ID,
          orgId: ORG_A,
          assessmentId: ASSESSMENT_ID,
          type: 'gradecam_csv',
          status: 'completed',
          fileUrl: null,
          mappingConfig: { foo: 'bar' },
          result: { rowsProcessed: 5, errors: 0, warnings: 0 },
          errorLog: [],
          createdById: USER_A_ID,
          createdAt,
          completedAt: createdAt,
        },
      });
      const service = new AnswerSheetsService(db, store);

      const job = await service.getJob(makeJwt(), JOB_ID);
      expect(job.id).toBe(JOB_ID);
      expect(job.orgId).toBe(ORG_A);
      expect(job.status).toBe('completed');
      expect(job.createdAt).toBe(createdAt.toISOString());
    });

    it('lanza 404 si el job no existe o pertenece a otra org', async () => {
      const db = buildMockDb({ jobRow: null });
      const service = new AnswerSheetsService(db, store);
      await expect(service.getJob(makeJwt(), JOB_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('listTemplates / getTemplate', () => {
    it('listTemplates devuelve los 4 formatos soportados', () => {
      const db = buildMockDb({});
      const service = new AnswerSheetsService(db, store);
      const templates = service.listTemplates();
      const formats = templates.map((t) => t.format).sort();
      expect(formats).toEqual(
        ['dia_official', 'generic_csv', 'gradecam_csv', 'zipgrade_csv'].sort(),
      );
      // Todas las plantillas tienen exampleCsv no vacío
      for (const t of templates) {
        expect((t.exampleCsv ?? '').length).toBeGreaterThan(0);
      }
    });

    it('getTemplate devuelve la plantilla correcta o null para formato inválido', () => {
      const db = buildMockDb({});
      const service = new AnswerSheetsService(db, store);
      const t = service.getTemplate('gradecam_csv');
      expect(t?.format).toBe('gradecam_csv');

      // @ts-expect-error  — caso inválido controlado
      expect(service.getTemplate('something_else')).toBeNull();
    });
  });
});
