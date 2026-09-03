import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Database } from '@soe/db';
import type { LayoutSpec, PageQuality } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { AnswerSheetsService } from '../answer-sheets/answer-sheets.service';
import type { AnswerSheetPreviewStore } from '../answer-sheets/lib/preview-store';
import type { FilesService } from '../files/files.service';
import type {
  DevelopmentGradingService,
  ScheduleConfirmedBatchParams,
} from './development-grading.service';
import {
  ScanReviewService,
  createAnswerSheetConfirmer,
  type AnswerSheetConfirmInput,
  type AnswerSheetConfirmer,
} from './scan-review.service';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const BATCH_ID = '33333333-3333-4333-8333-333333333333';
const INSTRUMENT_ID = '44444444-4444-4444-8444-444444444444';
const ASSESSMENT_ID = '55555555-5555-4555-8555-555555555555';
const CLASS_GROUP_ID = '66666666-6666-4666-8666-666666666666';
const MARK_ID = '77777777-7777-4777-8777-777777777777';
const SCAN_ID = '88888888-8888-4888-8888-888888888888';
const STUDENT_1 = '99999999-9999-4999-8999-999999999991';
const STUDENT_2 = '99999999-9999-4999-8999-999999999992';

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

function makeDb(selectResults: unknown[][]): {
  db: Database;
  updates: Array<Record<string, unknown>>;
} {
  let selectIdx = 0;
  const updates: Array<Record<string, unknown>> = [];

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
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        const result = Promise.resolve([]) as unknown as Promise<unknown[]> & {
          returning: () => Promise<unknown[]>;
        };
        result.returning = () => Promise.resolve([{ id: 'batch-1' }]);
        return { where: () => result };
      },
    }),
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  } as unknown as Database;

  return { db, updates };
}

function makeConfirmer(): {
  confirmer: AnswerSheetConfirmer;
  calls: Array<{ user: JwtPayload; input: AnswerSheetConfirmInput }>;
} {
  const calls: Array<{ user: JwtPayload; input: AnswerSheetConfirmInput }> = [];
  const confirmer: AnswerSheetConfirmer = {
    confirmParserResult: async (user, input) => {
      calls.push({ user, input });
      return { jobId: 'job-1', responsesCreated: 24 };
    },
  };
  return { confirmer, calls };
}

const filesServiceFake = {
  buildDownloadUrl: (row: { id: string }) => `https://signed/${row.id}`,
} as unknown as FilesService;

function makeService(selectResults: unknown[][]) {
  const { db, updates } = makeDb(selectResults);
  const { confirmer, calls: confirmCalls } = makeConfirmer();
  const gradingCalls: ScheduleConfirmedBatchParams[] = [];
  const developmentGradingFake = {
    scheduleConfirmedBatch: (params: ScheduleConfirmedBatchParams) => {
      gradingCalls.push(params);
    },
  } as unknown as DevelopmentGradingService;
  const service = new ScanReviewService(db, confirmer, filesServiceFake, developmentGradingFake);
  return { service, updates, confirmCalls, gradingCalls };
}

function bubbleField(fieldId: string, printedNumber: string, pageIndex: number, values: string[]) {
  return {
    fieldId,
    kind: 'bubble_group' as const,
    printedNumber,
    pageIndex,
    selectMode: 'single' as const,
    bubbles: values.map((value, i) => ({
      value,
      center: { x: 0.1 + i * 0.05, y: 0.2 },
      radius: 0.01,
    })),
    region: null,
  };
}

const SPEC: LayoutSpec = {
  specVersion: 1,
  instrumentId: INSTRUMENT_ID,
  pageCount: 2,
  paper: 'letter',
  fiducials: { kind: 'corner_squares', sizeRatio: 0.02, marginRatio: 0.03 },
  identity: { mode: 'qr', region: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 0.2, y: 0.1 } } },
  fields: [
    bubbleField('f1', '1', 0, ['A', 'B', 'C', 'D']),
    bubbleField('f2', '2', 0, ['A', 'B', 'C', 'D']),
    bubbleField('f3', '3', 1, ['V', 'F']),
  ],
};

const QUALITY_OK: PageQuality = {
  ok: true,
  sharpness: 0.9,
  glare: 0.05,
  fiducialsFound: 4,
  rejectReason: null,
};

const QUALITY_BLURRY: PageQuality = {
  ok: false,
  sharpness: 0.1,
  glare: 0.05,
  fiducialsFound: 4,
  rejectReason: 'blurry',
};

const USER: JwtPayload = {
  userId: USER_ID,
  orgId: ORG_ID,
  email: 'revisor@colegio.cl',
  name: 'Revisora',
  isPlatformAdmin: false,
  roles: ['eval_coordinator'],
  activeRole: 'eval_coordinator',
  role: 'eval_coordinator',
};

function scanQueueRow(overrides: Record<string, unknown>) {
  return {
    scanId: 'scan-x',
    state: 'read',
    quality: QUALITY_OK,
    pageIndex: 0,
    sheetSequence: 1,
    sheetStudentId: STUDENT_1,
    resolvedStudentId: STUDENT_1,
    identityConfidence: '1.000',
    thumbFileId: null,
    sheetFirstName: 'Ana',
    sheetLastName: 'Pérez',
    resolvedFirstName: 'Ana',
    resolvedLastName: 'Pérez',
    ...overrides,
  };
}

function markQueueRow(overrides: Record<string, unknown>) {
  return {
    markId: 'mark-x',
    scanId: 'scan-x',
    fieldId: 'f1',
    printedNumber: '1',
    state: 'ambiguous',
    value: null,
    fill: '0.400',
    threshold: '0.500',
    margin: '0.200',
    cropFileId: null,
    reviewedValue: null,
    reviewDecision: null,
    reviewedById: null,
    ...overrides,
  };
}

describe('ScanReviewService.getQueue', () => {
  it('ordena la cola por daño: calidad, identidades y marcas por margin ascendente', async () => {
    const scans = [
      scanQueueRow({ scanId: 'scan-read' }),
      scanQueueRow({
        scanId: 'scan-identity',
        state: 'identity_unresolved',
        sheetSequence: null,
        sheetStudentId: null,
        resolvedStudentId: null,
        identityConfidence: '0.200',
        sheetFirstName: null,
        sheetLastName: null,
        resolvedFirstName: null,
        resolvedLastName: null,
      }),
      scanQueueRow({
        scanId: 'scan-quality',
        state: 'quality_rejected',
        quality: QUALITY_BLURRY,
        thumbFileId: 'file-thumb',
      }),
    ];
    const marks = [
      markQueueRow({ markId: 'mark-dudosa', scanId: 'scan-read', margin: '0.200' }),
      markQueueRow({
        markId: 'mark-peor',
        scanId: 'scan-read',
        fieldId: 'f3',
        printedNumber: '3',
        state: 'multiple',
        margin: '0.050',
      }),
    ];
    const { service } = makeService([
      [{ id: BATCH_ID, spec: SPEC }],
      scans,
      marks,
      [{ id: 'file-thumb' }],
    ]);

    const queue = await service.getQueue(ORG_ID, BATCH_ID);

    expect(queue.batchId).toBe(BATCH_ID);
    expect(queue.qualityRejected).toHaveLength(1);
    expect(queue.qualityRejected[0]).toMatchObject({
      scanId: 'scan-quality',
      rejectReason: 'blurry',
      thumbUrl: 'https://signed/file-thumb',
    });
    expect(queue.identityUnresolved).toHaveLength(1);
    expect(queue.identityUnresolved[0]).toMatchObject({
      scanId: 'scan-identity',
      studentId: null,
      studentName: null,
      sheetSequence: null,
    });
    expect(queue.ambiguousMarks.map((m) => m.markId)).toEqual(['mark-peor', 'mark-dudosa']);
    expect(queue.ambiguousMarks[0].margin).toBeCloseTo(0.05);
  });

  it('arma las options de cada marca desde el spec y firma el crop', async () => {
    const marks = [
      markQueueRow({
        markId: 'mark-vf',
        scanId: 'scan-read',
        fieldId: 'f3',
        printedNumber: '3',
        cropFileId: 'file-crop',
      }),
    ];
    const { service } = makeService([
      [{ id: BATCH_ID, spec: SPEC }],
      [scanQueueRow({ scanId: 'scan-read' })],
      marks,
      [{ id: 'file-crop' }],
    ]);

    const queue = await service.getQueue(ORG_ID, BATCH_ID);

    expect(queue.ambiguousMarks[0].options).toEqual(['V', 'F']);
    expect(queue.ambiguousMarks[0].cropUrl).toBe('https://signed/file-crop');
    expect(queue.ambiguousMarks[0].studentName).toBe('Ana Pérez');
  });

  it('lanza NotFound cuando el lote no existe en la org', async () => {
    const { service } = makeService([[]]);

    await expect(service.getQueue(ORG_ID, BATCH_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

function resolveMarkRow(overrides: Record<string, unknown> = {}) {
  return {
    markId: MARK_ID,
    scanId: SCAN_ID,
    fieldId: 'f1',
    printedNumber: '1',
    state: 'ambiguous',
    value: null,
    fill: '0.400',
    threshold: '0.500',
    margin: '0.200',
    cropFileId: null,
    batchId: BATCH_ID,
    batchStatus: 'needs_review',
    spec: SPEC,
    sheetFirstName: 'Ana',
    sheetLastName: 'Pérez',
    resolvedFirstName: 'Ana',
    resolvedLastName: 'Pérez',
    ...overrides,
  };
}

describe('ScanReviewService.resolveMark', () => {
  it('rechaza con 400 un reviewedValue que no es alternativa del campo', async () => {
    const { service, updates } = makeService([[resolveMarkRow()]]);

    await expect(
      service.resolveMark(ORG_ID, USER_ID, MARK_ID, { decision: 'option', reviewedValue: 'Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updates).toHaveLength(0);
  });

  it('acepta la decisión humana de "en blanco"', async () => {
    const { service, updates } = makeService([[resolveMarkRow()], [{ total: 1 }], [{ total: 0 }]]);

    const model = await service.resolveMark(ORG_ID, USER_ID, MARK_ID, { decision: 'blank' });

    expect(updates[0]).toMatchObject({
      reviewedValue: null,
      reviewDecision: 'blank',
      reviewedById: USER_ID,
    });
    expect(updates[0].reviewedAt).toBeInstanceOf(Date);
    expect(model.reviewedValue).toBeNull();
    expect(model.reviewedDecision).toBe('blank');
    expect(model.reviewedById).toBe(USER_ID);
  });

  it('"anulada" se guarda como decisión propia, distinta de "en blanco"', async () => {
    const { service, updates } = makeService([
      [resolveMarkRow({ state: 'multiple' })],
      [{ total: 0 }],
      [{ total: 0 }],
    ]);

    const model = await service.resolveMark(ORG_ID, USER_ID, MARK_ID, { decision: 'annulled' });

    expect(updates[0]).toMatchObject({
      reviewedValue: null,
      reviewDecision: 'annulled',
      reviewedById: USER_ID,
    });
    expect(model.reviewedValue).toBeNull();
    expect(model.reviewedDecision).toBe('annulled');
  });

  it('escribe reviewedValue sin tocar jamás el value de máquina', async () => {
    const { service, updates } = makeService([[resolveMarkRow()], [{ total: 0 }], [{ total: 0 }]]);

    const model = await service.resolveMark(ORG_ID, USER_ID, MARK_ID, {
      decision: 'option',
      reviewedValue: 'B',
    });

    expect(updates[0]).toMatchObject({ decision: 'option', reviewedValue: 'B' });
    expect('value' in updates[0]).toBe(false);
    expect(model.value).toBeNull();
    expect(model.reviewedValue).toBe('B');
    expect(model.options).toEqual(['A', 'B', 'C', 'D']);
  });

  it('recalcula reviewPending del lote recontando pendientes', async () => {
    const { service, updates } = makeService([[resolveMarkRow()], [{ total: 2 }], [{ total: 3 }]]);

    await service.resolveMark(ORG_ID, USER_ID, MARK_ID, { decision: 'option', reviewedValue: 'A' });

    expect(updates).toHaveLength(2);
    expect(updates[1]).toMatchObject({ reviewPending: 5 });
  });

  it('rechaza con 409 si el lote no está en revisión', async () => {
    const { service, updates } = makeService([[resolveMarkRow({ batchStatus: 'confirmed' })]]);

    await expect(
      service.resolveMark(ORG_ID, USER_ID, MARK_ID, { decision: 'option', reviewedValue: 'A' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(updates).toHaveLength(0);
  });
});

function scanForReviewRow(overrides: Record<string, unknown> = {}) {
  return {
    scanId: SCAN_ID,
    state: 'identity_unresolved',
    quality: QUALITY_OK,
    pageIndex: 0,
    batchId: BATCH_ID,
    batchStatus: 'needs_review',
    resolvedStudentId: null,
    identityConfidence: null,
    identityEvidence: { qr: 'ilegible' },
    thumbFileId: null,
    sheetSequence: null,
    sheetStudentId: null,
    sheetFirstName: null,
    sheetLastName: null,
    resolvedFirstName: null,
    resolvedLastName: null,
    ...overrides,
  };
}

describe('ScanReviewService.assignIdentity', () => {
  it('asigna identidad manual: confianza 1.000, estado read y evidencia auditada', async () => {
    const { service, updates } = makeService([
      [scanForReviewRow()],
      [{ id: STUDENT_1, firstName: 'Ana', lastName: 'Pérez' }],
      [{ total: 0 }],
      [{ total: 0 }],
    ]);

    const model = await service.assignIdentity(ORG_ID, USER_ID, SCAN_ID, {
      studentId: STUDENT_1,
    });

    expect(updates[0]).toMatchObject({
      resolvedStudentId: STUDENT_1,
      identityConfidence: '1.000',
      state: 'read',
    });
    expect(updates[0].identityEvidence).toMatchObject({
      qr: 'ilegible',
      asignadoPor: USER_ID,
      motivo: 'manual',
      candidatoPrevio: null,
    });
    expect(model).toMatchObject({
      scanId: SCAN_ID,
      state: 'read',
      studentId: STUDENT_1,
      studentName: 'Ana Pérez',
      identityConfidence: 1,
    });
  });

  it('permite reasignar un scan ya leído y conserva el candidato previo en la evidencia', async () => {
    const { service, updates } = makeService([
      [
        scanForReviewRow({
          state: 'read',
          resolvedStudentId: STUDENT_1,
          identityConfidence: '0.900',
          identityEvidence: { qr: 'ok' },
        }),
      ],
      [{ id: STUDENT_2, firstName: 'Benjamín', lastName: 'Soto' }],
      [{ total: 0 }],
      [{ total: 0 }],
    ]);

    const model = await service.assignIdentity(ORG_ID, USER_ID, SCAN_ID, {
      studentId: STUDENT_2,
    });

    expect(updates[0]).toMatchObject({ resolvedStudentId: STUDENT_2, state: 'read' });
    expect(updates[0].identityEvidence).toMatchObject({
      qr: 'ok',
      candidatoPrevio: STUDENT_1,
      motivo: 'manual',
    });
    expect(model.studentName).toBe('Benjamín Soto');
  });

  it('lanza NotFound si el alumno no existe en la org', async () => {
    const { service, updates } = makeService([[scanForReviewRow()], []]);

    await expect(
      service.assignIdentity(ORG_ID, USER_ID, SCAN_ID, { studentId: STUDENT_2 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updates).toHaveLength(0);
  });

  it('rechaza asignar identidad a un scan superseded', async () => {
    const { service } = makeService([[scanForReviewRow({ state: 'superseded' })]]);

    await expect(
      service.assignIdentity(ORG_ID, USER_ID, SCAN_ID, { studentId: STUDENT_1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ScanReviewService.discardScan', () => {
  it('descarta como superseded con evidencia de autor y razón, y reconta pendientes', async () => {
    const { service, updates } = makeService([
      [scanForReviewRow({ state: 'quality_rejected', quality: QUALITY_BLURRY })],
      [{ total: 1 }],
      [{ total: 2 }],
    ]);

    const model = await service.discardScan(ORG_ID, USER_ID, SCAN_ID, {
      reason: 'Hoja ilegible, se re-escaneará',
    });

    expect(updates[0]).toMatchObject({ state: 'superseded' });
    expect(updates[0].identityEvidence).toMatchObject({
      descartadoPor: USER_ID,
      razon: 'Hoja ilegible, se re-escaneará',
    });
    expect(updates[1]).toMatchObject({ reviewPending: 3 });
    expect(model.state).toBe('superseded');
    expect(model.rejectReason).toBe('blurry');
  });
});

const CONFIRM_BATCH_ROW = {
  id: BATCH_ID,
  status: 'needs_review',
  assessmentId: ASSESSMENT_ID,
  classGroupId: CLASS_GROUP_ID,
  instrumentId: INSTRUMENT_ID,
  spec: SPEC,
};

const CONFIRM_SCANS = [
  {
    scanId: 'scan-1a',
    printedSheetId: 'sheet-1',
    pageIndex: 0,
    state: 'read',
    resolvedStudentId: STUDENT_1,
    sheetStudentId: STUDENT_1,
    sheetSequence: 1,
  },
  {
    scanId: 'scan-1b',
    printedSheetId: 'sheet-1',
    pageIndex: 1,
    state: 'read',
    resolvedStudentId: STUDENT_1,
    sheetStudentId: STUDENT_1,
    sheetSequence: 1,
  },
  {
    scanId: 'scan-2a',
    printedSheetId: 'sheet-2',
    pageIndex: 0,
    state: 'read',
    resolvedStudentId: null,
    sheetStudentId: STUDENT_2,
    sheetSequence: 2,
  },
];

const CONFIRM_MARKS = [
  {
    markId: 'm1',
    scanId: 'scan-1a',
    printedNumber: '1',
    state: 'marked',
    value: 'A',
    reviewedValue: null,
    reviewDecision: null,
    reviewedAt: null,
  },
  {
    markId: 'm2',
    scanId: 'scan-1a',
    printedNumber: '2',
    state: 'multiple',
    value: null,
    reviewedValue: null,
    reviewDecision: null,
    reviewedAt: null,
  },
  {
    markId: 'm3',
    scanId: 'scan-1b',
    printedNumber: '3',
    state: 'ambiguous',
    value: null,
    reviewedValue: 'F',
    reviewDecision: 'option',
    reviewedAt: new Date('2026-08-28T10:00:00Z'),
  },
  {
    markId: 'm4',
    scanId: 'scan-2a',
    printedNumber: '1',
    state: 'marked',
    value: 'B',
    reviewedValue: null,
    reviewDecision: null,
    reviewedAt: null,
  },
];

const CONFIRM_STUDENTS = [
  { id: STUDENT_1, rut: '12345678-5', firstName: 'Ana', lastName: 'Pérez' },
  { id: STUDENT_2, rut: '87654321-4', firstName: 'Benjamín', lastName: 'Soto' },
];

describe('ScanReviewService.confirmBatch', () => {
  it('confirma el lote por el camino de answer-sheets con el ParserResult del adaptador', async () => {
    const { service, updates, confirmCalls } = makeService([
      [CONFIRM_BATCH_ROW],
      CONFIRM_SCANS,
      CONFIRM_MARKS,
      CONFIRM_STUDENTS,
    ]);

    const result = await service.confirmBatch(ORG_ID, USER, BATCH_ID);

    expect(confirmCalls).toHaveLength(1);
    expect(confirmCalls[0].user).toBe(USER);
    expect(confirmCalls[0].input).toMatchObject({
      orgId: ORG_ID,
      instrumentId: INSTRUMENT_ID,
      classGroupId: CLASS_GROUP_ID,
      assessmentId: ASSESSMENT_ID,
    });
    const rows = confirmCalls[0].input.parserResult.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].rowNumber).toBe(1);
    expect(rows[0].studentRut).toBe('12345678-5');
    expect(rows[0].studentFullName).toBe('Ana Pérez');
    expect(rows[0].answers).toEqual({ '1': 'A', '2': null, '3': 'F' });

    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ status: 'confirmed' });
    expect(updates[1]).toMatchObject({ importJobId: 'job-1' });

    expect(result).toEqual({
      batchId: BATCH_ID,
      status: 'confirmed',
      importJobId: 'job-1',
      summary: { sheetsPersisted: 1, responsesPersisted: 24, assumedPending: 1 },
    });
  });

  it('cuenta como assumedPending las marcas ambiguas sin revisar y les registra el error ambiguous_mark', async () => {
    const { service, confirmCalls } = makeService([
      [CONFIRM_BATCH_ROW],
      CONFIRM_SCANS,
      CONFIRM_MARKS,
      CONFIRM_STUDENTS,
    ]);

    const result = await service.confirmBatch(ORG_ID, USER, BATCH_ID);

    const rows = confirmCalls[0].input.parserResult.rows;
    expect(rows[0].errors).toHaveLength(1);
    expect(rows[0].errors[0]).toMatchObject({ code: 'ambiguous_mark', field: '2' });
    expect(result.summary.assumedPending).toBe(1);
  });

  it('respeta el reviewedValue humano sin contar la marca revisada como pendiente', async () => {
    const { service, confirmCalls } = makeService([
      [CONFIRM_BATCH_ROW],
      CONFIRM_SCANS,
      CONFIRM_MARKS,
      CONFIRM_STUDENTS,
    ]);

    const result = await service.confirmBatch(ORG_ID, USER, BATCH_ID);

    const rows = confirmCalls[0].input.parserResult.rows;
    expect(rows[0].answers['3']).toBe('F');
    expect(result.summary.assumedPending).toBe(1);
  });

  it('una marca anulada llega al parser como respuesta nula y etiqueta anulada', async () => {
    const annulledMarks = CONFIRM_MARKS.map((mark) =>
      mark.markId === 'm2'
        ? {
            ...mark,
            reviewedValue: null,
            reviewDecision: 'annulled',
            reviewedAt: new Date('2026-08-28T10:00:00Z'),
          }
        : mark,
    );
    const { service, confirmCalls } = makeService([
      [CONFIRM_BATCH_ROW],
      CONFIRM_SCANS,
      annulledMarks,
      CONFIRM_STUDENTS,
    ]);

    const result = await service.confirmBatch(ORG_ID, USER, BATCH_ID);

    const rows = confirmCalls[0].input.parserResult.rows;
    expect(rows[0].answers['2']).toBeNull();
    expect(rows[0].annulledLabels).toEqual(['2']);
    expect(rows[0].errors).toEqual([]);
    expect(result.summary.assumedPending).toBe(0);
  });

  it('excluye de la persistencia la hoja con una página lógica faltante', async () => {
    const { service, confirmCalls } = makeService([
      [CONFIRM_BATCH_ROW],
      CONFIRM_SCANS,
      CONFIRM_MARKS,
      CONFIRM_STUDENTS,
    ]);

    const result = await service.confirmBatch(ORG_ID, USER, BATCH_ID);

    const ruts = confirmCalls[0].input.parserResult.rows.map((r) => r.studentRut);
    expect(ruts).toEqual(['12345678-5']);
    expect(result.summary.sheetsPersisted).toBe(1);
  });

  it('rechaza con 400 un lote cuya tirada no tiene evaluación asociada', async () => {
    const { service, confirmCalls } = makeService([[{ ...CONFIRM_BATCH_ROW, assessmentId: null }]]);

    await expect(service.confirmBatch(ORG_ID, USER, BATCH_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(confirmCalls).toHaveLength(0);
  });

  it('rechaza con 409 un lote que no está en needs_review', async () => {
    const { service } = makeService([[{ ...CONFIRM_BATCH_ROW, status: 'processing' }]]);

    await expect(service.confirmBatch(ORG_ID, USER, BATCH_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('B4: confirma un lote rut_bubbles agrupado por printedSheet — 2 alumnos resueltos por RUT entran, la hoja sin resolver queda fuera', async () => {
    const rutSpec: LayoutSpec = {
      ...SPEC,
      pageCount: 1,
      identity: {
        mode: 'rut_bubbles',
        region: { topLeft: { x: 0.05, y: 0.03 }, bottomRight: { x: 0.52, y: 0.3 } },
        bubbles: [
          { value: '1', center: { x: 0.1, y: 0.05 }, radius: 0.008, group: 0 },
          { value: '5', center: { x: 0.15, y: 0.05 }, radius: 0.008, group: 1 },
        ],
      },
      fields: [bubbleField('f1', '1', 0, ['A', 'B', 'C', 'D'])],
    };
    const rutScans = [
      {
        scanId: 'scan-g1',
        printedSheetId: 'sheet-g1',
        pageIndex: 0,
        state: 'read',
        resolvedStudentId: STUDENT_1,
        sheetStudentId: null,
        sheetSequence: 1,
      },
      {
        scanId: 'scan-g2',
        printedSheetId: 'sheet-g2',
        pageIndex: 0,
        state: 'read',
        resolvedStudentId: STUDENT_2,
        sheetStudentId: null,
        sheetSequence: 2,
      },
      {
        scanId: 'scan-g3',
        printedSheetId: 'sheet-g3',
        pageIndex: 0,
        state: 'identity_unresolved',
        resolvedStudentId: null,
        sheetStudentId: null,
        sheetSequence: 3,
      },
    ];
    const rutMarks = [
      {
        markId: 'mg1',
        scanId: 'scan-g1',
        printedNumber: '1',
        state: 'marked',
        value: 'A',
        reviewedValue: null,
        reviewedAt: null,
      },
      {
        markId: 'mg2',
        scanId: 'scan-g2',
        printedNumber: '1',
        state: 'marked',
        value: 'C',
        reviewedValue: null,
        reviewedAt: null,
      },
      {
        markId: 'mg3',
        scanId: 'scan-g3',
        printedNumber: '1',
        state: 'marked',
        value: 'D',
        reviewedValue: null,
        reviewedAt: null,
      },
    ];
    const { service, confirmCalls } = makeService([
      [{ ...CONFIRM_BATCH_ROW, spec: rutSpec }],
      rutScans,
      rutMarks,
      CONFIRM_STUDENTS,
    ]);

    const result = await service.confirmBatch(ORG_ID, USER, BATCH_ID);

    const rows = confirmCalls[0].input.parserResult.rows;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.studentRut)).toEqual(['12345678-5', '87654321-4']);
    expect(rows[0].answers).toEqual({ '1': 'A' });
    expect(rows[1].answers).toEqual({ '1': 'C' });
    expect(result.summary.sheetsPersisted).toBe(2);
    expect(result.summary.assumedPending).toBe(0);
  });

  it('B4: un lote rut_bubbles sin ningún alumno resuelto rechaza con 400 reportando las hojas sin identidad', async () => {
    const rutScans = [
      {
        scanId: 'scan-g1',
        printedSheetId: 'sheet-g1',
        pageIndex: 0,
        state: 'identity_unresolved',
        resolvedStudentId: null,
        sheetStudentId: null,
        sheetSequence: 1,
      },
    ];
    const { service, confirmCalls } = makeService([
      [{ ...CONFIRM_BATCH_ROW, spec: { ...SPEC, pageCount: 1 } }],
      rutScans,
      [],
      [],
    ]);

    await expect(service.confirmBatch(ORG_ID, USER, BATCH_ID)).rejects.toThrow(/sin identidad: 1/);
    expect(confirmCalls).toHaveLength(0);
  });

  it('excluye las marcas crop_region del ParserResult (CD-9: el recorte no es una alternativa)', async () => {
    const specWithCrop: LayoutSpec = {
      ...SPEC,
      fields: [
        ...SPEC.fields,
        {
          fieldId: 'f_dev',
          kind: 'crop_region',
          printedNumber: '4',
          pageIndex: 1,
          selectMode: 'single',
          bubbles: [],
          region: { topLeft: { x: 0.1, y: 0.5 }, bottomRight: { x: 0.9, y: 0.8 } },
        },
      ],
    };
    const cropMark = {
      markId: 'm-crop',
      scanId: 'scan-1b',
      printedNumber: '4',
      state: 'marked',
      value: null,
      reviewedValue: null,
      reviewedAt: null,
    };
    const { service, confirmCalls } = makeService([
      [{ ...CONFIRM_BATCH_ROW, spec: specWithCrop }],
      CONFIRM_SCANS,
      [...CONFIRM_MARKS, cropMark],
      CONFIRM_STUDENTS,
    ]);

    const result = await service.confirmBatch(ORG_ID, USER, BATCH_ID);

    const rows = confirmCalls[0].input.parserResult.rows;
    expect(rows[0].answers).toEqual({ '1': 'A', '2': null, '3': 'F' });
    expect(rows[0].answers).not.toHaveProperty('4');
    expect(result.summary.assumedPending).toBe(1);
  });

  it('agenda la corrección de desarrollo con los datos del lote tras confirmar', async () => {
    const { service, gradingCalls } = makeService([
      [CONFIRM_BATCH_ROW],
      CONFIRM_SCANS,
      CONFIRM_MARKS,
      CONFIRM_STUDENTS,
    ]);

    await service.confirmBatch(ORG_ID, USER, BATCH_ID);

    expect(gradingCalls).toEqual([
      {
        orgId: ORG_ID,
        batchId: BATCH_ID,
        assessmentId: ASSESSMENT_ID,
        instrumentId: INSTRUMENT_ID,
        spec: SPEC,
      },
    ]);
  });

  it('no agenda corrección de desarrollo si el confirm de answer-sheets falla', async () => {
    const { db } = makeDb([[CONFIRM_BATCH_ROW], CONFIRM_SCANS, CONFIRM_MARKS, CONFIRM_STUDENTS]);
    const gradingCalls: ScheduleConfirmedBatchParams[] = [];
    const failingConfirmer: AnswerSheetConfirmer = {
      confirmParserResult: async () => {
        throw new Error('falló la ingesta');
      },
    };
    const developmentGradingFake = {
      scheduleConfirmedBatch: (params: ScheduleConfirmedBatchParams) => {
        gradingCalls.push(params);
      },
    } as unknown as DevelopmentGradingService;
    const service = new ScanReviewService(
      db,
      failingConfirmer,
      filesServiceFake,
      developmentGradingFake,
    );

    await expect(service.confirmBatch(ORG_ID, USER, BATCH_ID)).rejects.toThrow('falló la ingesta');
    expect(gradingCalls).toHaveLength(0);
  });

  it('rechaza con 400 cuando no queda ninguna hoja completa e identificada', async () => {
    const incompleteOnly = [CONFIRM_SCANS[2]];
    const { service, confirmCalls } = makeService([
      [CONFIRM_BATCH_ROW],
      incompleteOnly,
      [CONFIRM_MARKS[3]],
      [CONFIRM_STUDENTS[1]],
    ]);

    await expect(service.confirmBatch(ORG_ID, USER, BATCH_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(confirmCalls).toHaveLength(0);
  });
});

function makeAnswerSheetsFake(): {
  svc: AnswerSheetsService;
  calls: Array<{ user: JwtPayload; body: Record<string, unknown> }>;
} {
  const calls: Array<{ user: JwtPayload; body: Record<string, unknown> }> = [];
  const svc = {
    confirm: async (user: JwtPayload, body: Record<string, unknown>) => {
      calls.push({ user, body });
      return {
        jobId: 'job-1',
        assessmentId: ASSESSMENT_ID,
        status: 'completed',
        responsesCreated: 24,
        studentsProcessed: 1,
        rowsSkipped: 0,
        errors: [],
      };
    },
  };
  return { svc: svc as unknown as AnswerSheetsService, calls };
}

function makePreviewStoreFake(): {
  store: AnswerSheetPreviewStore;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  const store = {
    set: (payload: Record<string, unknown>) => {
      calls.push(payload);
      return { ...payload, previewToken: 'tok-1', createdAt: new Date(), expiresAt: new Date() };
    },
  };
  return { store: store as unknown as AnswerSheetPreviewStore, calls };
}

const PARSER_RESULT = {
  rows: [
    {
      rowNumber: 1,
      studentRut: '12345678-5',
      studentFullName: 'Ana Pérez',
      answers: { '1': 'A' },
      errors: [],
    },
  ],
  detectedColumns: ['1'],
  warnings: [],
};

describe('createAnswerSheetConfirmer', () => {
  it('siembra el preview store y confirma con token de un solo uso, sin crear assessment nuevo', async () => {
    const { store, calls: storeCalls } = makePreviewStoreFake();
    const { svc, calls: confirmCalls } = makeAnswerSheetsFake();
    const confirmer = createAnswerSheetConfirmer(svc, store);

    const outcome = await confirmer.confirmParserResult(USER, {
      orgId: ORG_ID,
      instrumentId: INSTRUMENT_ID,
      classGroupId: CLASS_GROUP_ID,
      assessmentId: ASSESSMENT_ID,
      parserResult: PARSER_RESULT,
    });

    expect(storeCalls[0]).toMatchObject({
      orgId: ORG_ID,
      userId: USER_ID,
      format: 'generic_csv',
      instrumentId: INSTRUMENT_ID,
      classGroupId: CLASS_GROUP_ID,
      assessmentId: ASSESSMENT_ID,
      assessmentName: null,
      columnMapping: null,
      rows: PARSER_RESULT.rows,
      detectedColumns: ['1'],
    });
    expect(confirmCalls[0].body).toEqual({
      previewToken: 'tok-1',
      createAssessment: false,
      assessmentId: ASSESSMENT_ID,
      skipErrorRows: false,
    });
    expect(outcome).toEqual({ jobId: 'job-1', responsesCreated: 24 });
  });

  it('confirma con la org efectiva aunque el JWT no la traiga (platform_admin cross-org)', async () => {
    const { store } = makePreviewStoreFake();
    const { svc, calls: confirmCalls } = makeAnswerSheetsFake();
    const confirmer = createAnswerSheetConfirmer(svc, store);
    const platformAdmin: JwtPayload = { ...USER, orgId: null, isPlatformAdmin: true };

    await confirmer.confirmParserResult(platformAdmin, {
      orgId: ORG_ID,
      instrumentId: INSTRUMENT_ID,
      classGroupId: null,
      assessmentId: ASSESSMENT_ID,
      parserResult: PARSER_RESULT,
    });

    expect(confirmCalls[0].user.orgId).toBe(ORG_ID);
  });
});
