import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
const OTHER_INSTRUMENT_ID = '77777777-7777-4777-8777-777777777777';
const ASSESSMENT_ID = '88888888-8888-4888-8888-888888888888';

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
): { db: Database; inserts: unknown[]; updates: unknown[] } {
  let selectIdx = 0;
  let insertIdx = 0;
  const inserts: unknown[] = [];
  const updates: unknown[] = [];

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
    update: () => ({
      set: (values: unknown) => {
        updates.push(values);
        return { where: () => Promise.resolve([]) };
      },
    }),
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  } as unknown as Database;

  return { db, inserts, updates };
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
const AUTO_ASSESSMENT_RETURNING: unknown[][] = [[{ id: ASSESSMENT_ID }], []];
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
      [...AUTO_ASSESSMENT_RETURNING, RUN_RETURNING],
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

    expect(inserts).toHaveLength(4);
    expect(inserts[0]).toMatchObject({
      orgId: ORG_ID,
      instrumentId: INSTRUMENT_ID,
      mode: 'paper',
      status: 'scheduled',
    });
    expect(inserts[1]).toEqual({ assessmentId: ASSESSMENT_ID, classGroupId: CLASS_GROUP_ID });
    expect(inserts[2]).toMatchObject({
      orgId: ORG_ID,
      sheetCount: 5,
      createdById: USER_ID,
      assessmentId: ASSESSMENT_ID,
    });

    const sheetValues = inserts[3] as Array<{
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
      [...AUTO_ASSESSMENT_RETURNING, [{ ...RUN_RETURNING[0], spareCount: 0, sheetCount: 3 }]],
    );
    const service = new SheetPrintService(db);

    await service.createRun(ORG_ID, USER_ID, { ...CREATE_DTO, spareCount: 0 });

    expect(inserts[2]).toMatchObject({ sheetCount: 3, spareCount: 0 });
    expect(inserts[3]).toHaveLength(3);
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

describe('SheetPrintService.createRun — evaluación asociada', () => {
  const WITH_ASSESSMENT = { ...CREATE_DTO, assessmentId: ASSESSMENT_ID };

  it('usa la evaluación elegida sin crear una nueva', async () => {
    const { db, inserts } = makeDb(
      [
        [LAYOUT_ROW],
        [CLASS_GROUP_ROW],
        ROSTER_ROWS,
        [{ id: ASSESSMENT_ID, instrumentId: INSTRUMENT_ID }],
      ],
      [[{ ...RUN_RETURNING[0], assessmentId: ASSESSMENT_ID }]],
    );
    const service = new SheetPrintService(db);

    const run = await service.createRun(ORG_ID, USER_ID, WITH_ASSESSMENT);

    expect(run.assessmentId).toBe(ASSESSMENT_ID);
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toMatchObject({ assessmentId: ASSESSMENT_ID });
  });

  it('rechaza una evaluación de otra organización (no la ve dentro del contexto de org)', async () => {
    const { db } = makeDb([[LAYOUT_ROW], [CLASS_GROUP_ROW], ROSTER_ROWS, []]);
    const service = new SheetPrintService(db);

    await expect(service.createRun(ORG_ID, USER_ID, WITH_ASSESSMENT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rechaza una evaluación de otro instrumento que el del layout', async () => {
    const { db } = makeDb([
      [LAYOUT_ROW],
      [CLASS_GROUP_ROW],
      ROSTER_ROWS,
      [{ id: ASSESSMENT_ID, instrumentId: OTHER_INSTRUMENT_ID }],
    ]);
    const service = new SheetPrintService(db);

    await expect(service.createRun(ORG_ID, USER_ID, WITH_ASSESSMENT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('SheetPrintService.updateRun', () => {
  const RUN_LOOKUP = [
    {
      id: RUN_ID,
      assessmentId: null,
      instrumentId: INSTRUMENT_ID,
      classGroupId: CLASS_GROUP_ID,
      classGroupName: '3° Básico A',
    },
  ];
  const UPDATED_RUN_ROW = {
    id: RUN_ID,
    layoutId: LAYOUT_ID,
    layoutVersion: 3,
    instrumentId: INSTRUMENT_ID,
    classGroupId: CLASS_GROUP_ID,
    classGroupName: '3° Básico A',
    assessmentId: ASSESSMENT_ID,
    spareCount: 2,
    sheetCount: 5,
    pdfFileId: null,
    createdById: USER_ID,
    createdAt: new Date('2026-08-01T12:00:00Z'),
  };

  it('asocia la evaluación a una tirada sin lotes confirmados', async () => {
    const { db, updates } = makeDb([
      RUN_LOOKUP,
      [], // sin lote confirmado
      [{ id: ASSESSMENT_ID, instrumentId: INSTRUMENT_ID }],
      [UPDATED_RUN_ROW],
    ]);
    const service = new SheetPrintService(db);

    const run = await service.updateRun(ORG_ID, USER_ID, RUN_ID, { assessmentId: ASSESSMENT_ID });

    expect(updates).toEqual([{ assessmentId: ASSESSMENT_ID }]);
    expect(run.assessmentId).toBe(ASSESSMENT_ID);
  });

  it('lanza NotFound cuando la tirada no existe en la org del token', async () => {
    const { db } = makeDb([[]]);
    const service = new SheetPrintService(db);

    await expect(
      service.updateRun(ORG_ID, USER_ID, RUN_ID, { assessmentId: ASSESSMENT_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza una evaluación de otra organización', async () => {
    const { db, updates } = makeDb([RUN_LOOKUP, [], []]);
    const service = new SheetPrintService(db);

    await expect(
      service.updateRun(ORG_ID, USER_ID, RUN_ID, { assessmentId: ASSESSMENT_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updates).toHaveLength(0);
  });

  it('rechaza una evaluación cuyo instrumento no es el del layout', async () => {
    const { db, updates } = makeDb([
      RUN_LOOKUP,
      [],
      [{ id: ASSESSMENT_ID, instrumentId: OTHER_INSTRUMENT_ID }],
    ]);
    const service = new SheetPrintService(db);

    await expect(
      service.updateRun(ORG_ID, USER_ID, RUN_ID, { assessmentId: ASSESSMENT_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updates).toHaveLength(0);
  });

  it('rechaza el cambio si la tirada ya tiene un lote confirmado', async () => {
    const { db, updates } = makeDb([
      [{ ...RUN_LOOKUP[0], assessmentId: 'otra-evaluacion' }],
      [{ id: 'batch-confirmado' }],
    ]);
    const service = new SheetPrintService(db);

    await expect(
      service.updateRun(ORG_ID, USER_ID, RUN_ID, { assessmentId: ASSESSMENT_ID }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(updates).toHaveLength(0);
  });

  it('es idempotente: reasignar la MISMA evaluación no consulta lotes confirmados', async () => {
    const { db, updates } = makeDb([
      [{ ...RUN_LOOKUP[0], assessmentId: ASSESSMENT_ID }],
      [{ id: ASSESSMENT_ID, instrumentId: INSTRUMENT_ID }],
      [UPDATED_RUN_ROW],
    ]);
    const service = new SheetPrintService(db);

    await expect(
      service.updateRun(ORG_ID, USER_ID, RUN_ID, { assessmentId: ASSESSMENT_ID }),
    ).resolves.toMatchObject({ assessmentId: ASSESSMENT_ID });
    expect(updates).toEqual([{ assessmentId: ASSESSMENT_ID }]);
  });

  it('crea la evaluación del instrumento y la asocia cuando se pide createAssessment', async () => {
    const { db, inserts, updates } = makeDb(
      [RUN_LOOKUP, [], [UPDATED_RUN_ROW]],
      [[{ id: ASSESSMENT_ID }], []],
    );
    const service = new SheetPrintService(db);

    const run = await service.updateRun(ORG_ID, USER_ID, RUN_ID, { createAssessment: true });

    expect(inserts[0]).toMatchObject({
      orgId: ORG_ID,
      instrumentId: INSTRUMENT_ID,
      mode: 'paper',
      status: 'scheduled',
      config: { source: 'sheet_print_run' },
    });
    expect(inserts[1]).toEqual({ assessmentId: ASSESSMENT_ID, classGroupId: CLASS_GROUP_ID });
    expect(updates).toEqual([{ assessmentId: ASSESSMENT_ID }]);
    expect(run.assessmentId).toBe(ASSESSMENT_ID);
  });

  it('no crea la evaluación si la tirada ya tiene un lote confirmado', async () => {
    const { db, inserts, updates } = makeDb([
      [{ ...RUN_LOOKUP[0], assessmentId: ASSESSMENT_ID }],
      [{ id: 'batch-confirmado' }],
    ]);
    const service = new SheetPrintService(db);

    await expect(
      service.updateRun(ORG_ID, USER_ID, RUN_ID, { createAssessment: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('rechaza createAssessment en una tirada sin curso asociado', async () => {
    const { db, inserts } = makeDb([
      [{ ...RUN_LOOKUP[0], classGroupId: null, classGroupName: null }],
      [],
    ]);
    const service = new SheetPrintService(db);

    await expect(
      service.updateRun(ORG_ID, USER_ID, RUN_ID, { createAssessment: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inserts).toHaveLength(0);
  });
});

describe('SheetPrintService.listAssessmentOptions', () => {
  it('devuelve las evaluaciones candidatas del instrumento', async () => {
    const rows = [
      {
        id: ASSESSMENT_ID,
        name: 'DIA Lectura 3° · Intermedio',
        status: 'scheduled',
        administeredAt: null,
        createdAt: new Date('2026-08-01T12:00:00Z'),
      },
    ];
    const { db } = makeDb([rows]);
    const service = new SheetPrintService(db);

    await expect(service.listAssessmentOptions(ORG_ID, INSTRUMENT_ID)).resolves.toEqual(rows);
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
    assessmentFormId: undefined,
    administeredAt: null,
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
      shortCode: 0x0a1b2c3d,
      firstName: 'Ana',
      lastName: 'Pérez',
    },
    {
      id: '8e1b0933-2a6d-4b00-8c9c-4d7e6a1b0c22',
      sequence: 2,
      shortCode: null,
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

describe('SheetPrintService — hoja genérica y formas (v1)', () => {
  const FORM_ID = '77777777-7777-4777-8777-777777777777';
  const ASSESSMENT_ID = '88888888-8888-4888-8888-888888888888';
  const FORM_ROW = { id: FORM_ID, assessmentId: ASSESSMENT_ID, instrumentId: INSTRUMENT_ID };
  const rutSpec = deriveLayoutDraft(
    INSTRUMENT_ID,
    Array.from({ length: 4 }, (_, i) => mcItem(i + 1)),
    'rut_bubbles',
  ).spec;

  it('layout rut_bubbles: la tirada crea N copias genéricas SIN alumno, cada una con su hoja propia (D13)', async () => {
    const { db, inserts } = makeDb(
      [[{ ...LAYOUT_ROW, spec: rutSpec }], [CLASS_GROUP_ROW], ROSTER_ROWS],
      [...AUTO_ASSESSMENT_RETURNING, RUN_RETURNING],
    );
    const service = new SheetPrintService(db);

    const run = await service.createRun(ORG_ID, USER_ID, CREATE_DTO);

    expect(run.sheetCount).toBe(5);
    const sheetValues = inserts[3] as Array<{ studentId: string | null; sequence: number }>;
    expect(sheetValues).toHaveLength(5);
    expect(sheetValues.every((s) => s.studentId === null)).toBe(true);
    expect(sheetValues.map((s) => s.sequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it('persiste el assessmentFormId de la tirada y lo expone en el modelo (CD-13)', async () => {
    const { db, inserts } = makeDb(
      [[LAYOUT_ROW], [FORM_ROW], [CLASS_GROUP_ROW], ROSTER_ROWS],
      [[{ ...RUN_RETURNING[0], assessmentId: ASSESSMENT_ID, assessmentFormId: FORM_ID }]],
    );
    const service = new SheetPrintService(db);

    const run = await service.createRun(ORG_ID, USER_ID, {
      ...CREATE_DTO,
      assessmentFormId: FORM_ID,
    });

    expect(inserts[0]).toMatchObject({ assessmentFormId: FORM_ID });
    expect(run.assessmentFormId).toBe(FORM_ID);
  });

  it('deriva el assessmentId de la forma cuando el dto no lo trae (el confirm recibe la evaluación correcta)', async () => {
    const { db, inserts } = makeDb(
      [[LAYOUT_ROW], [FORM_ROW], [CLASS_GROUP_ROW], ROSTER_ROWS],
      [[{ ...RUN_RETURNING[0], assessmentId: ASSESSMENT_ID, assessmentFormId: FORM_ID }]],
    );
    const service = new SheetPrintService(db);

    const run = await service.createRun(ORG_ID, USER_ID, {
      ...CREATE_DTO,
      assessmentId: null,
      assessmentFormId: FORM_ID,
    });

    expect(inserts[0]).toMatchObject({ assessmentId: ASSESSMENT_ID, assessmentFormId: FORM_ID });
    expect(run.assessmentId).toBe(ASSESSMENT_ID);
  });

  it('rechaza con NotFound una forma inexistente o de otra org', async () => {
    const { db } = makeDb([[LAYOUT_ROW], []]);
    const service = new SheetPrintService(db);

    await expect(
      service.createRun(ORG_ID, USER_ID, { ...CREATE_DTO, assessmentFormId: FORM_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza con BadRequest una forma cuya evaluación usa otro instrumento que el layout', async () => {
    const { db } = makeDb([
      [LAYOUT_ROW],
      [{ ...FORM_ROW, instrumentId: '99999999-9999-4999-8999-999999999999' }],
    ]);
    const service = new SheetPrintService(db);

    await expect(
      service.createRun(ORG_ID, USER_ID, { ...CREATE_DTO, assessmentFormId: FORM_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza con BadRequest una forma que no pertenece al assessmentId pedido en el dto', async () => {
    const { db } = makeDb([[LAYOUT_ROW], [FORM_ROW]]);
    const service = new SheetPrintService(db);

    await expect(
      service.createRun(ORG_ID, USER_ID, {
        ...CREATE_DTO,
        assessmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        assessmentFormId: FORM_ID,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('listForms devuelve las formas de las evaluaciones del instrumento del layout con el shape del contrato', async () => {
    const createdAt = new Date('2026-08-15T10:00:00Z');
    const formRows = [
      {
        id: FORM_ID,
        name: 'Forma A',
        assessmentId: ASSESSMENT_ID,
        assessmentName: 'Ensayo SIMCE Agosto',
        createdAt,
      },
      {
        id: '99999999-9999-4999-8999-999999999999',
        name: 'Forma B',
        assessmentId: ASSESSMENT_ID,
        assessmentName: 'Ensayo SIMCE Agosto',
        createdAt,
      },
    ];
    const { db } = makeDb([[LAYOUT_ROW], formRows]);
    const service = new SheetPrintService(db);

    const result = await service.listForms(ORG_ID, LAYOUT_ID);

    expect(result).toEqual({ data: formRows });
  });

  it('listForms lanza NotFound cuando el layout no existe en la org', async () => {
    const { db } = makeDb([[]]);
    const service = new SheetPrintService(db);

    await expect(service.listForms(ORG_ID, LAYOUT_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listForms devuelve data vacía cuando el instrumento no tiene formas', async () => {
    const { db } = makeDb([[LAYOUT_ROW], []]);
    const service = new SheetPrintService(db);

    const result = await service.listForms(ORG_ID, LAYOUT_ID);

    expect(result).toEqual({ data: [] });
  });

  it('renderPdf de una tirada genérica dibuja la grilla RUT sin alumnos y conserva el pageCount', async () => {
    const { db } = makeDb([
      [{ id: RUN_ID, spec: rutSpec, specHash: 'a3f9c1e70b4d2856', classGroupName: '3° Básico A' }],
      [
        {
          id: '9f2c1a44-3b7e-4c11-9a0d-5e8f7b2c1d33',
          sequence: 1,
          shortCode: 0x0a1b2c3d,
          firstName: null,
          lastName: null,
        },
        {
          id: '8e1b0933-2a6d-4b00-8c9c-4d7e6a1b0c22',
          sequence: 2,
          shortCode: 0x0a1b2c3e,
          firstName: null,
          lastName: null,
        },
      ],
    ]);
    const service = new SheetPrintService(db);

    const pdf = await service.renderPdf(ORG_ID, RUN_ID);
    const doc = await PDFDocument.load(pdf);

    expect(doc.getPageCount()).toBe(rutSpec.pageCount * 2);
  });
});

describe('SheetPrintService — fecha de aplicación', () => {
  const LAYOUT_ROW_2 = { id: LAYOUT_ID, version: 3, instrumentId: INSTRUMENT_ID };
  const CLASS_GROUP_ROW_2 = { id: CLASS_GROUP_ID, name: '3° Básico A' };
  const ROSTER_ROWS_2 = [{ id: 'student-a' }, { id: 'student-b' }, { id: 'student-c' }];
  const RUN_ROW_2 = {
    id: RUN_ID,
    assessmentId: ASSESSMENT_ID,
    spareCount: 2,
    sheetCount: 5,
    pdfFileId: null,
    createdById: USER_ID,
    createdAt: new Date('2026-08-01T12:00:00Z'),
  };
  const RUN_LOOKUP_2 = [
    {
      id: RUN_ID,
      assessmentId: ASSESSMENT_ID,
      instrumentId: INSTRUMENT_ID,
      classGroupId: CLASS_GROUP_ID,
      classGroupName: '3° Básico A',
    },
  ];
  const UPDATED_ROW_2 = {
    id: RUN_ID,
    layoutId: LAYOUT_ID,
    layoutVersion: 3,
    instrumentId: INSTRUMENT_ID,
    classGroupId: CLASS_GROUP_ID,
    classGroupName: '3° Básico A',
    assessmentId: ASSESSMENT_ID,
    administeredAt: new Date('2026-04-30T12:00:00Z'),
    spareCount: 2,
    sheetCount: 5,
    pdfFileId: null,
    createdById: USER_ID,
    createdAt: new Date('2026-08-01T12:00:00Z'),
  };

  it('la evaluación que nace de la tirada ya guarda la fecha elegida', async () => {
    const { db, inserts } = makeDb(
      [[LAYOUT_ROW_2], [CLASS_GROUP_ROW_2], ROSTER_ROWS_2],
      [[{ id: ASSESSMENT_ID }], [], [RUN_ROW_2]],
    );
    const service = new SheetPrintService(db);

    await service.createRun(ORG_ID, USER_ID, { ...CREATE_DTO, administeredAt: '2026-04-30' });

    expect(inserts[0]).toMatchObject({
      administeredAt: new Date('2026-04-30T12:00:00.000Z'),
    });
  });

  it('la evaluación existente recibe la fecha elegida al crear la tirada', async () => {
    const { db, updates } = makeDb(
      [
        [LAYOUT_ROW_2],
        [CLASS_GROUP_ROW_2],
        ROSTER_ROWS_2,
        [{ id: ASSESSMENT_ID, instrumentId: INSTRUMENT_ID }],
      ],
      [[RUN_ROW_2]],
    );
    const service = new SheetPrintService(db);

    await service.createRun(ORG_ID, USER_ID, {
      ...CREATE_DTO,
      assessmentId: ASSESSMENT_ID,
      administeredAt: '2026-04-30',
    });

    expect(updates).toEqual([{ administeredAt: new Date('2026-04-30T12:00:00.000Z') }]);
  });

  it('sin fecha en el dto NO se toca la fecha de la evaluación existente', async () => {
    const { db, updates } = makeDb(
      [
        [LAYOUT_ROW_2],
        [CLASS_GROUP_ROW_2],
        ROSTER_ROWS_2,
        [{ id: ASSESSMENT_ID, instrumentId: INSTRUMENT_ID }],
      ],
      [[RUN_ROW_2]],
    );
    const service = new SheetPrintService(db);

    await service.createRun(ORG_ID, USER_ID, { ...CREATE_DTO, assessmentId: ASSESSMENT_ID });

    expect(updates).toHaveLength(0);
  });

  it('updateRun con sólo la fecha no reasigna la evaluación ni consulta lotes confirmados', async () => {
    const { db, updates } = makeDb([RUN_LOOKUP_2, [UPDATED_ROW_2]]);
    const service = new SheetPrintService(db);

    const run = await service.updateRun(ORG_ID, USER_ID, RUN_ID, {
      administeredAt: '2026-04-30',
    });

    expect(updates).toEqual([{ administeredAt: new Date('2026-04-30T12:00:00.000Z') }]);
    expect(run.administeredAt).toEqual(new Date('2026-04-30T12:00:00Z'));
  });

  it('updateRun con fecha null la limpia', async () => {
    const { db, updates } = makeDb([RUN_LOOKUP_2, [{ ...UPDATED_ROW_2, administeredAt: null }]]);
    const service = new SheetPrintService(db);

    await service.updateRun(ORG_ID, USER_ID, RUN_ID, { administeredAt: null });

    expect(updates).toEqual([{ administeredAt: null }]);
  });

  it('updateRun rechaza fijar la fecha en una tirada sin evaluación asociada', async () => {
    const { db, updates } = makeDb([[{ ...RUN_LOOKUP_2[0], assessmentId: null }]]);
    const service = new SheetPrintService(db);

    await expect(
      service.updateRun(ORG_ID, USER_ID, RUN_ID, { administeredAt: '2026-04-30' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updates).toHaveLength(0);
  });

  it('renderPdf arma la cabecera con instrumento y fecha sin perder hojas', async () => {
    const spec = makeSpec(20);
    const { db } = makeDb([
      [
        {
          id: RUN_ID,
          spec,
          specHash: 'a3f9c1e70b4d2856',
          classGroupName: '3° Básico A',
          administeredAt: new Date('2026-04-30T12:00:00Z'),
          instrumentName: 'DIA Lectura 3° Básico 2026',
          instrumentYear: 2026,
          instrumentApplicationPeriod: 'diagnostico',
          subjectName: 'Lectura',
          gradeName: '3° Básico',
        },
      ],
      [
        {
          id: '9f2c1a44-3b7e-4c11-9a0d-5e8f7b2c1d33',
          sequence: 1,
          shortCode: null,
          firstName: 'Ana',
          lastName: 'Pérez',
        },
        {
          id: '8e1b0933-2a6d-4b00-8c9c-4d7e6a1b0c22',
          sequence: 2,
          shortCode: null,
          firstName: null,
          lastName: null,
        },
      ],
    ]);
    const service = new SheetPrintService(db);

    const pdf = await service.renderPdf(ORG_ID, RUN_ID);
    const doc = await PDFDocument.load(pdf);

    expect(doc.getPageCount()).toBe(spec.pageCount * 2);
  });
});
