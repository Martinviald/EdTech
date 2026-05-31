import {
  BadRequestException,
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
const STUDENT_1 = '11110000-0000-0000-0000-000000000001';
const NODE_1 = '22220000-0000-0000-0000-000000000001';
const JOB_ID = '99990000-0000-0000-0000-000000000001';

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
  assessmentRow?: { id: string; orgId: string } | null;
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
    return {
      where: (_w: Where) => buildWhereChain(lastFromTable),
      orderBy: (..._args: unknown[]) => resolveForTable(lastFromTable),
    };
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
            content: { correctKey: 'A' },
            scoringConfig: { points: 1 },
          },
          {
            id: ITEM_2,
            position: 2,
            content: { correctKey: 'B' },
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
            content: { correctKey: 'A' },
            scoringConfig: { points: 1 },
          },
          {
            id: ITEM_2,
            position: 2,
            content: { correctKey: 'B' },
            scoringConfig: { points: 1 },
          },
        ],
        taxonomyTags: [{ itemId: ITEM_1, nodeId: NODE_1 }],
        studentRows: [
          { id: STUDENT_1, rut: '12345678-5', firstName: 'Juan', lastName: 'Pérez' },
        ],
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
