import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import type { Database } from '@soe/db';
import type { ItemContent, LayoutSpec } from '@soe/types';
import { deriveLayoutDraft, type DerivableItem } from './sheet-layout.helpers';
import { SheetPrintService } from './sheet-print.service';

const ORG_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const LAYOUT_ID = '44444444-4444-4444-8444-444444444444';
const CLASS_GROUP_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const INSTRUMENT_ID = '11111111-1111-4111-8111-111111111111';

type QueryChain = {
  from: (..._: unknown[]) => QueryChain;
  where: (..._: unknown[]) => QueryChain;
  innerJoin: (..._: unknown[]) => QueryChain;
  leftJoin: (..._: unknown[]) => QueryChain;
  orderBy: (..._: unknown[]) => QueryChain;
  limit: (..._: unknown[]) => QueryChain;
  offset: (..._: unknown[]) => QueryChain;
  then: <T>(resolve: (rows: unknown[]) => T, reject?: (err: unknown) => unknown) => Promise<T>;
};

function makeDb(
  selectResults: unknown[][],
  insertReturning: unknown[][] = [],
): { db: Database; inserts: unknown[] } {
  let selectIdx = 0;
  let insertIdx = 0;
  const inserts: unknown[] = [];

  function chain(rows: unknown[]): QueryChain {
    const c: QueryChain = {
      from: () => c,
      where: () => c,
      innerJoin: () => c,
      leftJoin: () => c,
      orderBy: () => c,
      limit: () => c,
      offset: () => c,
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) as never,
    };
    return c;
  }

  const db = {
    select: () => chain(selectResults[selectIdx++] ?? []),
    insert: () => {
      const rows = insertReturning[insertIdx++] ?? [];
      return {
        values: (values: unknown) => {
          inserts.push(values);
          return {
            returning: () => Promise.resolve(rows),
            then: (resolve: (r: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
              Promise.resolve(rows).then(resolve, reject),
          };
        },
      };
    },
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  } as unknown as Database;

  return { db, inserts };
}

function mcItem(position: number): DerivableItem {
  return {
    id: `item-${position}`,
    position,
    printedNumber: null,
    type: 'multiple_choice',
    content: {
      stem: `Pregunta ${position}`,
      alternatives: ['A', 'B', 'C', 'D'].map((key) => ({
        key,
        text: `Alt ${key}`,
        isCorrect: key === 'A',
      })),
    } as ItemContent,
  };
}

function makeSpec(itemCount: number): LayoutSpec {
  const items = Array.from({ length: itemCount }, (_, i) => mcItem(i + 1));
  return deriveLayoutDraft(INSTRUMENT_ID, items).spec;
}

const LAYOUT_ROW = { id: LAYOUT_ID, version: 3, instrumentId: INSTRUMENT_ID };
const CLASS_GROUP_ROW = { id: CLASS_GROUP_ID, name: '3° Básico A' };
const ROSTER_ROWS = [{ id: 'student-a' }, { id: 'student-b' }, { id: 'student-c' }];
const RUN_RETURNING = [
  {
    id: RUN_ID,
    assessmentId: null,
    spareCount: 2,
    sheetCount: 5,
    pdfFileId: null,
    createdById: USER_ID,
    createdAt: new Date('2026-08-01T12:00:00Z'),
  },
];

const CREATE_DTO = {
  layoutId: LAYOUT_ID,
  classGroupId: CLASS_GROUP_ID,
  assessmentId: null,
  spareCount: 2,
};

describe('SheetPrintService.createRun', () => {
  it('crea la tirada con una hoja por alumno y las reservas al final, en secuencia', async () => {
    const { db, inserts } = makeDb(
      [[LAYOUT_ROW], [CLASS_GROUP_ROW], ROSTER_ROWS],
      [RUN_RETURNING],
    );
    const service = new SheetPrintService(db);

    const run = await service.createRun(ORG_ID, USER_ID, CREATE_DTO);

    expect(run).toMatchObject({
      id: RUN_ID,
      layoutId: LAYOUT_ID,
      layoutVersion: 3,
      instrumentId: INSTRUMENT_ID,
      classGroupId: CLASS_GROUP_ID,
      classGroupName: '3° Básico A',
      spareCount: 2,
      sheetCount: 5,
    });

    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toMatchObject({ orgId: ORG_ID, sheetCount: 5, createdById: USER_ID });

    const sheetValues = inserts[1] as Array<{
      studentId: string | null;
      sequence: number;
      printRunId: string;
      orgId: string;
    }>;
    expect(sheetValues).toHaveLength(5);
    expect(sheetValues.map((s) => s.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(sheetValues.slice(0, 3).map((s) => s.studentId)).toEqual([
      'student-a',
      'student-b',
      'student-c',
    ]);
    expect(sheetValues.slice(3).map((s) => s.studentId)).toEqual([null, null]);
    expect(sheetValues.every((s) => s.printRunId === RUN_ID && s.orgId === ORG_ID)).toBe(true);
  });

  it('sheetCount = alumnos + reservas incluso sin reservas', async () => {
    const { db, inserts } = makeDb(
      [[LAYOUT_ROW], [CLASS_GROUP_ROW], ROSTER_ROWS],
      [[{ ...RUN_RETURNING[0], spareCount: 0, sheetCount: 3 }]],
    );
    const service = new SheetPrintService(db);

    await service.createRun(ORG_ID, USER_ID, { ...CREATE_DTO, spareCount: 0 });

    expect(inserts[0]).toMatchObject({ sheetCount: 3, spareCount: 0 });
    expect(inserts[1]).toHaveLength(3);
  });

  it('rechaza un layout inexistente en la org', async () => {
    const { db } = makeDb([[]]);
    const service = new SheetPrintService(db);

    await expect(service.createRun(ORG_ID, USER_ID, CREATE_DTO)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rechaza un curso inexistente en la org', async () => {
    const { db } = makeDb([[LAYOUT_ROW], []]);
    const service = new SheetPrintService(db);

    await expect(service.createRun(ORG_ID, USER_ID, CREATE_DTO)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rechaza un curso sin alumnos activos', async () => {
    const { db } = makeDb([[LAYOUT_ROW], [CLASS_GROUP_ROW], []]);
    const service = new SheetPrintService(db);

    await expect(service.createRun(ORG_ID, USER_ID, CREATE_DTO)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('SheetPrintService.getRun / list', () => {
  const RUN_ROW = {
    id: RUN_ID,
    layoutId: LAYOUT_ID,
    layoutVersion: 3,
    instrumentId: INSTRUMENT_ID,
    classGroupId: CLASS_GROUP_ID,
    classGroupName: '3° Básico A',
    assessmentId: null,
    spareCount: 2,
    sheetCount: 5,
    pdfFileId: null,
    createdById: USER_ID,
    createdAt: new Date('2026-08-01T12:00:00Z'),
  };

  it('getRun devuelve el PrintRunModel', async () => {
    const { db } = makeDb([[RUN_ROW]]);
    const service = new SheetPrintService(db);

    const model = await service.getRun(ORG_ID, RUN_ID);

    expect(model).toEqual(RUN_ROW);
  });

  it('getRun lanza NotFound cuando la tirada no existe', async () => {
    const { db } = makeDb([[]]);
    const service = new SheetPrintService(db);

    await expect(service.getRun(ORG_ID, RUN_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list devuelve la envoltura paginada { data, total, page, limit }', async () => {
    const { db } = makeDb([[{ total: 11 }], [RUN_ROW]]);
    const service = new SheetPrintService(db);

    const result = await service.list(ORG_ID, { page: 3, limit: 4 });

    expect(result.total).toBe(11);
    expect(result.page).toBe(3);
    expect(result.limit).toBe(4);
    expect(result.data).toEqual([RUN_ROW]);
  });
});

describe('SheetPrintService.renderPdf', () => {
  const spec = makeSpec(80);

  const PDF_RUN_ROW = {
    id: RUN_ID,
    spec,
    specHash: 'a3f9c1e70b4d2856',
    classGroupName: '3° Básico A',
  };

  const SHEET_ROWS = [
    {
      id: '9f2c1a44-3b7e-4c11-9a0d-5e8f7b2c1d33',
      sequence: 1,
      firstName: 'Ana',
      lastName: 'Pérez',
    },
    {
      id: '8e1b0933-2a6d-4b00-8c9c-4d7e6a1b0c22',
      sequence: 2,
      firstName: null,
      lastName: null,
    },
  ];

  it('produce un PDF con pageCount × hojas páginas', async () => {
    expect(spec.pageCount).toBe(2);
    const { db } = makeDb([[PDF_RUN_ROW], SHEET_ROWS]);
    const service = new SheetPrintService(db);

    const pdf = await service.renderPdf(ORG_ID, RUN_ID);
    const doc = await PDFDocument.load(pdf);

    expect(doc.getPageCount()).toBe(spec.pageCount * SHEET_ROWS.length);
  });

  it('lanza NotFound cuando la tirada no existe', async () => {
    const { db } = makeDb([[]]);
    const service = new SheetPrintService(db);

    await expect(service.renderPdf(ORG_ID, RUN_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lanza BadRequest cuando la tirada no tiene hojas registradas', async () => {
    const { db } = makeDb([[PDF_RUN_ROW], []]);
    const service = new SheetPrintService(db);

    await expect(service.renderPdf(ORG_ID, RUN_ID)).rejects.toBeInstanceOf(BadRequestException);
  });
});
