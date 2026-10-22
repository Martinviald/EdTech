import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Database } from '@soe/db';
import type { LayoutSpec, PageQuality, RubricEngine } from '@soe/types';
import type {
  AnswerReadingConsolidationService,
  ConfirmedReadingsInput,
  ReadingConfirmation,
} from '../answer-reading/answer-reading-consolidation.service';
import type { RubricGradingService } from '../answer-reading/rubric-grading.service';
import type { JwtPayload } from '../auth/jwt-payload.types';
import * as observability from '../common/observability/report-error';
import type {
  AnswerSheetsService,
  RescoreScannedAnswerInput,
} from '../answer-sheets/answer-sheets.service';
import type { AssessmentResultsService } from '../assessment-results/assessment-results.service';
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
  for: (..._: unknown[]) => QueryChain;
  then: <T>(resolve: (rows: unknown[]) => T, reject?: (err: unknown) => unknown) => Promise<T>;
};

function makeDb(selectResults: unknown[][]): {
  db: Database;
  updates: Array<Record<string, unknown>>;
  locks: unknown[][];
  transactions: { opened: number };
} {
  let selectIdx = 0;
  const updates: Array<Record<string, unknown>> = [];
  const locks: unknown[][] = [];
  const transactions = { opened: 0 };

  function chain(rows: unknown[]): QueryChain {
    const c: QueryChain = {
      from: () => c,
      where: () => c,
      innerJoin: () => c,
      leftJoin: () => c,
      orderBy: () => c,
      limit: () => c,
      offset: () => c,
      for: (...args: unknown[]) => {
        locks.push(args);
        return c;
      },
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) as never,
    };
    return c;
  }

  const db = {
    select: () => chain(selectResults[selectIdx++] ?? []),
    selectDistinct: () => chain(selectResults[selectIdx++] ?? []),
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
    transaction: async (fn: (tx: unknown) => unknown) => {
      transactions.opened += 1;
      return fn(db);
    },
  } as unknown as Database;

  return { db, updates, locks, transactions };
}

function makeConfirmer(): {
  confirmer: AnswerSheetConfirmer;
  calls: Array<{ user: JwtPayload; input: AnswerSheetConfirmInput }>;
  rescoreCalls: Array<{ tx: Database; orgId: string; input: RescoreScannedAnswerInput }>;
  refreshCalls: Array<{ orgId: string; recalculated: readonly string[] }>;
} {
  const calls: Array<{ user: JwtPayload; input: AnswerSheetConfirmInput }> = [];
  const rescoreCalls: Array<{ tx: Database; orgId: string; input: RescoreScannedAnswerInput }> = [];
  const refreshCalls: Array<{ orgId: string; recalculated: readonly string[] }> = [];
  const confirmer: AnswerSheetConfirmer = {
    confirmParserResult: async (user, input) => {
      calls.push({ user, input });
      return { jobId: 'job-1', responsesCreated: 24 };
    },
    rescoreScannedAnswer: async (tx, orgId, input) => {
      rescoreCalls.push({ tx, orgId, input });
      return [input.assessmentId];
    },
    refreshResultsAfterRescore: (orgId, recalculated) => {
      refreshCalls.push({ orgId, recalculated });
    },
  };
  return { confirmer, calls, rescoreCalls, refreshCalls };
}

const filesServiceFake = {
  buildDownloadUrl: (row: { id: string }) => `https://signed/${row.id}`,
} as unknown as FilesService;

function makeReadingConsolidation(
  readings: Map<string, ReadingConfirmation> = new Map(),
  linkError: Error | null = null,
) {
  const linkCalls: Array<{ orgId: string; input: ConfirmedReadingsInput }> = [];
  const readingCalls: Array<{ orgId: string; batchId: string }> = [];
  const consolidation = {
    readingsForConfirmation: async (orgId: string, batchId: string) => {
      readingCalls.push({ orgId, batchId });
      return readings;
    },
    linkConfirmedResponses: async (orgId: string, input: ConfirmedReadingsInput) => {
      linkCalls.push({ orgId, input });
      if (linkError) throw linkError;
      return null;
    },
  } as unknown as AnswerReadingConsolidationService;
  return { consolidation, linkCalls, readingCalls };
}

function makeRubricGrading(engine: RubricEngine | Error = 'legacy') {
  const rubricBatches: Array<{ orgId: string; batchId: string }> = [];
  const rubricGrading = {
    engineFor: async () => {
      if (engine instanceof Error) throw engine;
      return engine;
    },
    scheduleForBatch: (orgId: string, batchId: string) => {
      rubricBatches.push({ orgId, batchId });
    },
  } as unknown as RubricGradingService;
  return { rubricGrading, rubricBatches };
}

function makeService(
  selectResults: unknown[][],
  readings?: Map<string, ReadingConfirmation>,
  linkError: Error | null = null,
  engine: RubricEngine | Error = 'legacy',
) {
  const { db, updates, locks, transactions } = makeDb(selectResults);
  const { confirmer, calls: confirmCalls, rescoreCalls, refreshCalls } = makeConfirmer();
  const gradingCalls: ScheduleConfirmedBatchParams[] = [];
  const developmentGradingFake = {
    scheduleConfirmedBatch: (params: ScheduleConfirmedBatchParams) => {
      gradingCalls.push(params);
    },
  } as unknown as DevelopmentGradingService;
  const { consolidation, linkCalls, readingCalls } = makeReadingConsolidation(readings, linkError);
  const { rubricGrading, rubricBatches } = makeRubricGrading(engine);
  const service = new ScanReviewService(
    db,
    confirmer,
    filesServiceFake,
    developmentGradingFake,
    consolidation,
    rubricGrading,
  );
  return {
    service,
    updates,
    confirmCalls,
    gradingCalls,
    linkCalls,
    readingCalls,
    rubricBatches,
    rescoreCalls,
    refreshCalls,
    locks,
    transactions,
    db,
  };
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
    sourceFileId: null,
    sourcePageIndex: null,
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
    suggestedValue: null,
    doubtReason: null,
    nullConfidence: null,
    reviewedValue: null,
    reviewDecision: null,
    reviewedById: null,
    autoResolved: false,
    aiResolution: null,
    ...overrides,
  };
}

function aiResolution(overrides: Record<string, unknown> = {}) {
  return {
    version: 'mark-disambiguation-v1',
    mode: 'live',
    verdict: 'agree',
    route: 'auto',
    value: 'B',
    applied: true,
    engines: [],
    thresholds: { jev: null, openai: null },
    decidedAt: '2026-10-22T12:00:00.000Z',
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

  // Regresión de la hoja de RESERVA. El motor sólo genera thumb si la calidad
  // falla o el QR es ilegible; una reserva tiene los dos bien, así que llegaba a
  // la cola de identidad SIN ninguna imagen y había que elegir al alumno a ciegas
  // — el nombre está escrito a mano en la hoja. Ahora viaja la hoja original.
  it('una hoja sin thumb expone la hoja original para poder identificarla', async () => {
    const scans = [
      scanQueueRow({
        scanId: 'scan-reserva',
        state: 'identity_unresolved',
        sheetStudentId: null,
        resolvedStudentId: null,
        sheetFirstName: null,
        sheetLastName: null,
        resolvedFirstName: null,
        resolvedLastName: null,
        thumbFileId: null,
        sourceFileId: 'file-origen',
        sourcePageIndex: 4,
      }),
    ];
    const { service } = makeService([
      [{ id: BATCH_ID, spec: SPEC }],
      scans,
      [],
      [{ id: 'file-origen', mimeType: 'application/pdf' }],
    ]);

    const queue = await service.getQueue(ORG_ID, BATCH_ID);

    expect(queue.identityUnresolved).toHaveLength(1);
    expect(queue.identityUnresolved[0]).toMatchObject({
      scanId: 'scan-reserva',
      thumbUrl: null,
      sourceUrl: 'https://signed/file-origen',
      // El tipo NO es decorativo: con un PDF hay que abrirlo como PDF, no como
      // imagen, o la vista queda en blanco sin ningún error.
      sourceContentType: 'application/pdf',
      sourcePageIndex: 4,
    });
  });

  it('arma las options de cada marca desde el spec y firma el crop', async () => {
    const marks = [
      markQueueRow({
        markId: 'mark-vf',
        scanId: 'scan-read',
        fieldId: 'f3',
        printedNumber: '3',
        cropFileId: 'file-crop',
        suggestedValue: 'V',
        doubtReason: 'band',
        nullConfidence: '0.880',
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
    expect(queue.ambiguousMarks[0]).toMatchObject({
      suggestedValue: 'V',
      doubtReason: 'band',
      nullConfidence: 0.88,
    });
  });

  it('una marca persistida por un motor v1 expone los campos del contrato v2 en null', async () => {
    const { service } = makeService([
      [{ id: BATCH_ID, spec: SPEC }],
      [scanQueueRow({ scanId: 'scan-read' })],
      [markQueueRow({ markId: 'mark-v1', scanId: 'scan-read' })],
      [],
    ]);

    const queue = await service.getQueue(ORG_ID, BATCH_ID);

    expect(queue.ambiguousMarks[0]).toMatchObject({
      suggestedValue: null,
      doubtReason: null,
      nullConfidence: null,
    });
  });

  it('lanza NotFound cuando el lote no existe en la org', async () => {
    const { service } = makeService([[]]);

    await expect(service.getQueue(ORG_ID, BATCH_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('B2: las dobles anuladas por el sistema salen aparte, con su recorte firmado, y no como pendientes', async () => {
    const { service } = makeService([
      [{ id: BATCH_ID, spec: SPEC, orgConfig: { review: { autoAnnulMinConfidence: 0.9 } } }],
      [scanQueueRow({ scanId: 'scan-read' })],
      [],
      [
        markQueueRow({
          markId: 'mark-auto',
          scanId: 'scan-read',
          fieldId: 'f3',
          printedNumber: '3',
          state: 'multiple',
          cropFileId: 'file-crop',
          nullConfidence: '0.980',
          reviewDecision: 'annulled',
          autoResolved: true,
        }),
      ],
      [{ id: 'file-crop' }],
    ]);

    const queue = await service.getQueue(ORG_ID, BATCH_ID);

    expect(queue.ambiguousMarks).toEqual([]);
    expect(queue.autoAnnulled).toHaveLength(1);
    expect(queue.autoAnnulled[0]).toMatchObject({
      markId: 'mark-auto',
      autoResolved: true,
      reviewedDecision: 'annulled',
      reviewedById: null,
      nullConfidence: 0.98,
      cropUrl: 'https://signed/file-crop',
      options: ['V', 'F'],
      studentName: 'Ana Pérez',
    });
    expect(queue.settings.autoAnnulMinConfidence).toBe(0.9);
  });

  // El default se invirtió: `quickConfirm` nació apagado, nadie lo encendió, y en
  // el primer uso real el revisor tecleó a mano 5 marcas cuya alternativa el motor
  // ya había sugerido. Ahora ausente = ENCENDIDO y sólo un `false` explícito lo
  // apaga. La nula automática NO cambió: sigue apagada salvo valor explícito.
  it('B1: settings.quickConfirm sale de organizations.config.review y está ENCENDIDO por defecto', async () => {
    const sinConfig = makeService([[{ id: BATCH_ID, spec: SPEC, orgConfig: null }], [], [], []]);
    const apagadoExplicito = makeService([
      [{ id: BATCH_ID, spec: SPEC, orgConfig: { review: { quickConfirm: false } } }],
      [],
      [],
      [],
    ]);
    const encendidoExplicito = makeService([
      [{ id: BATCH_ID, spec: SPEC, orgConfig: { review: { quickConfirm: true } } }],
      [],
      [],
      [],
    ]);

    expect((await sinConfig.service.getQueue(ORG_ID, BATCH_ID)).settings).toEqual({
      quickConfirm: true,
      autoAnnulMinConfidence: null,
    });
    expect((await apagadoExplicito.service.getQueue(ORG_ID, BATCH_ID)).settings).toEqual({
      quickConfirm: false,
      autoAnnulMinConfidence: null,
    });
    expect((await encendidoExplicito.service.getQueue(ORG_ID, BATCH_ID)).settings).toEqual({
      quickConfirm: true,
      autoAnnulMinConfidence: null,
    });
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
    suggestedValue: null,
    doubtReason: null,
    nullConfidence: null,
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

  it('B1: "confirm" persiste la sugerencia del motor como decisión option', async () => {
    const { service, updates } = makeService([
      [resolveMarkRow({ suggestedValue: 'B', doubtReason: 'margin' })],
      [{ total: 0 }],
      [{ total: 0 }],
    ]);

    const model = await service.resolveMark(ORG_ID, USER_ID, MARK_ID, { decision: 'confirm' });

    expect(updates[0]).toMatchObject({
      reviewedValue: 'B',
      reviewDecision: 'option',
      reviewedById: USER_ID,
    });
    expect(model.reviewedValue).toBe('B');
    expect(model.reviewedDecision).toBe('option');
    expect(model.suggestedValue).toBe('B');
  });

  it('B2: corregir una nula automática la vuelve decisión humana (autoResolved false)', async () => {
    const { service, updates } = makeService([
      [resolveMarkRow({ state: 'multiple', nullConfidence: '0.980' })],
      [{ total: 0 }],
      [{ total: 0 }],
    ]);

    const model = await service.resolveMark(ORG_ID, USER_ID, MARK_ID, {
      decision: 'option',
      reviewedValue: 'B',
    });

    expect(updates[0]).toMatchObject({
      reviewedValue: 'B',
      reviewDecision: 'option',
      reviewedById: USER_ID,
      autoResolved: false,
    });
    expect(model.autoResolved).toBe(false);
  });

  it('B1: "confirm" sobre una marca sin sugerencia responde 400 y no escribe', async () => {
    const { service, updates } = makeService([[resolveMarkRow({ state: 'multiple' })]]);

    await expect(
      service.resolveMark(ORG_ID, USER_ID, MARK_ID, { decision: 'confirm' }),
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

    expect(updates[0]).toMatchObject({ reviewDecision: 'option', reviewedValue: 'B' });
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

const SPEC_WITH_CROP: LayoutSpec = {
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

const CROP_MARK = {
  markId: 'm-crop',
  scanId: 'scan-1b',
  printedNumber: '4',
  state: 'marked',
  value: null,
  reviewedValue: null,
  reviewDecision: null,
  reviewedAt: null,
};

const CONFIRM_STUDENTS = [
  { id: STUDENT_1, rut: '12345678-5', firstName: 'Ana', lastName: 'Pérez' },
  { id: STUDENT_2, rut: '87654321-4', firstName: 'Benjamín', lastName: 'Soto' },
];

function cropSelectResults(): unknown[][] {
  return [
    [{ ...CONFIRM_BATCH_ROW, spec: SPEC_WITH_CROP }],
    CONFIRM_SCANS,
    [...CONFIRM_MARKS, CROP_MARK],
    CONFIRM_STUDENTS,
  ];
}

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
    expect(rows[0].answers).toEqual({ '1': 'A', '3': 'F' });
    expect(rows[0].pendingReviewLabels).toEqual(['2']);

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

  it('deja pendientes de revisión, nunca en 0, las marcas dudosas sin revisar y les registra el error ambiguous_mark', async () => {
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
    expect(rows[0].answers).not.toHaveProperty('2');
    expect(rows[0].pendingReviewLabels).toEqual(['2']);
    expect(result.summary.assumedPending).toBe(1);
  });

  it('una página con recortes y su burbuja indecidible no deja la alternativa en 0 al confirmar sin revisarla', async () => {
    const undecidedBubble = {
      markId: 'm-undecided',
      scanId: 'scan-1a',
      printedNumber: '1',
      state: 'ambiguous',
      value: null,
      reviewedValue: null,
      reviewDecision: null,
      reviewedAt: null,
    };
    const { service, confirmCalls } = makeService([
      [{ ...CONFIRM_BATCH_ROW, spec: SPEC_WITH_CROP }],
      CONFIRM_SCANS.filter((scan) => scan.printedSheetId === 'sheet-1'),
      [undecidedBubble, CROP_MARK],
      CONFIRM_STUDENTS,
    ]);

    const result = await service.confirmBatch(ORG_ID, USER, BATCH_ID);

    const [row] = confirmCalls[0].input.parserResult.rows;
    expect(row.answers).toEqual({});
    expect(row.pendingReviewLabels).toEqual(['1']);
    expect(row.pendingReadingLabels).toEqual(['4']);
    expect(row.errors).toEqual([expect.objectContaining({ code: 'ambiguous_mark', field: '1' })]);
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

  it('sin decisión de lectura todavía, la marca de recorte queda pendiente, nunca en blanco', async () => {
    const { service, confirmCalls, linkCalls } = makeService(cropSelectResults());

    const result = await service.confirmBatch(ORG_ID, USER, BATCH_ID);

    const rows = confirmCalls[0].input.parserResult.rows;
    expect(rows[0].answers).toEqual({ '1': 'A', '3': 'F' });
    expect(rows[0].pendingReviewLabels).toEqual(['2']);
    expect(rows[0].answers).not.toHaveProperty('4');
    expect(rows[0].pendingReadingLabels).toEqual(['4']);
    expect(rows[0].prescoredAnswers).toBeUndefined();
    expect(result.summary.assumedPending).toBe(1);
    expect(linkCalls).toEqual([
      {
        orgId: ORG_ID,
        input: {
          assessmentId: ASSESSMENT_ID,
          links: [],
          cropMarks: [{ markId: 'm-crop', studentId: STUDENT_1, itemId: null }],
        },
      },
    ]);
  });

  it('informa el ítem de cada marca de recorte confirmada para reservar su respuesta', async () => {
    const [batchRows, ...rest] = cropSelectResults();
    const cropField = SPEC_WITH_CROP.fields.find((field) => field.fieldId === 'f_dev');
    const specWithResponse: LayoutSpec = {
      ...SPEC_WITH_CROP,
      fields: [
        ...SPEC_WITH_CROP.fields.filter((field) => field.fieldId !== 'f_dev'),
        {
          ...(cropField as LayoutSpec['fields'][number]),
          response: {
            itemId: 'item-4',
            format: { kind: 'integer', maxChars: 3, allowNegative: false },
            boxes: [],
            cropProfileId: 'short-answer@1',
          },
        },
      ],
    };
    const { service, linkCalls } = makeService([
      [{ ...(batchRows?.[0] as object), spec: specWithResponse }],
      ...rest,
    ]);

    await service.confirmBatch(ORG_ID, USER, BATCH_ID);

    expect(linkCalls[0].input.cropMarks).toEqual([
      { markId: 'm-crop', studentId: STUDENT_1, itemId: 'item-4' },
    ]);
  });

  it('una lectura autoaceptada llega corregida al parser y se vincula a la respuesta', async () => {
    const prescored = {
      itemId: 'item-4',
      value: { answer: '21/10', reading: { canonical: 'q:21/10', decisionId: 'dec-1' } },
      isCorrect: true,
      rawScore: 1,
      scoredBy: 'ai' as const,
      aiScore: { score: 1, confidence: 0.91, decisionId: 'dec-1' },
    };
    const { service, confirmCalls, linkCalls } = makeService(
      cropSelectResults(),
      new Map([['m-crop', { decisionId: 'dec-1', itemId: 'item-4', prescored }]]),
    );

    await service.confirmBatch(ORG_ID, USER, BATCH_ID);

    const rows = confirmCalls[0].input.parserResult.rows;
    expect(rows[0].prescoredAnswers).toEqual({ '4': prescored });
    expect(rows[0].pendingReadingLabels).toBeUndefined();
    expect(linkCalls[0].input.links).toEqual([
      { decisionId: 'dec-1', studentId: STUDENT_1, itemId: 'item-4', consolidated: true },
    ]);
  });

  it('una lectura que espera revisión queda pendiente y se vincula sin consolidar', async () => {
    const { service, confirmCalls, linkCalls } = makeService(
      cropSelectResults(),
      new Map([['m-crop', { decisionId: 'dec-2', itemId: 'item-4', prescored: null }]]),
    );

    await service.confirmBatch(ORG_ID, USER, BATCH_ID);

    const rows = confirmCalls[0].input.parserResult.rows;
    expect(rows[0].pendingReadingLabels).toEqual(['4']);
    expect(rows[0].prescoredAnswers).toBeUndefined();
    expect(linkCalls[0].input.links).toEqual([
      { decisionId: 'dec-2', studentId: STUDENT_1, itemId: 'item-4', consolidated: false },
    ]);
  });

  it('ignora la decisión de una marca de hoja reemplazada (no viene entre las marcas vigentes)', async () => {
    const prescored = {
      itemId: 'item-4',
      value: { answer: '7', reading: { canonical: 'n:7', decisionId: 'dec-old' } },
      isCorrect: false,
      rawScore: 0,
      scoredBy: 'ai' as const,
      aiScore: null,
    };
    const { service, confirmCalls, linkCalls } = makeService(
      cropSelectResults(),
      new Map([['m-crop-superseded', { decisionId: 'dec-old', itemId: 'item-4', prescored }]]),
    );

    await service.confirmBatch(ORG_ID, USER, BATCH_ID);

    const rows = confirmCalls[0].input.parserResult.rows;
    expect(rows[0].pendingReadingLabels).toEqual(['4']);
    expect(rows[0].prescoredAnswers).toBeUndefined();
    expect(linkCalls[0].input.links).toEqual([]);
    expect(linkCalls[0].input.cropMarks).toEqual([
      { markId: 'm-crop', studentId: STUDENT_1, itemId: null },
    ]);
  });

  it('un fallo al vincular las lecturas se reporta sin deshacer la confirmación', async () => {
    const reportSpy = jest.spyOn(observability, 'reportServerError').mockImplementation(() => {});
    const { service } = makeService(cropSelectResults(), new Map(), new Error('sin conexión'));

    const result = await service.confirmBatch(ORG_ID, USER, BATCH_ID);

    expect(result.status).toBe('confirmed');
    expect(reportSpy).toHaveBeenCalledWith(expect.any(Error), {
      orgId: ORG_ID,
      batchId: BATCH_ID,
      stage: 'link_answer_readings',
    });
    reportSpy.mockRestore();
  });

  it('sin campos de recorte no consulta lecturas', async () => {
    const { service, readingCalls, linkCalls } = makeService([
      [CONFIRM_BATCH_ROW],
      CONFIRM_SCANS,
      CONFIRM_MARKS,
      CONFIRM_STUDENTS,
    ]);

    await service.confirmBatch(ORG_ID, USER, BATCH_ID);

    expect(readingCalls).toHaveLength(0);
    expect(linkCalls[0].input).toEqual({ assessmentId: ASSESSMENT_ID, links: [], cropMarks: [] });
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

  it('con el motor legacy no agenda la calificación con rúbrica', async () => {
    const { service, gradingCalls, rubricBatches } = makeService([
      [CONFIRM_BATCH_ROW],
      CONFIRM_SCANS,
      CONFIRM_MARKS,
      CONFIRM_STUDENTS,
    ]);

    await service.confirmBatch(ORG_ID, USER, BATCH_ID);

    expect(gradingCalls).toHaveLength(1);
    expect(rubricBatches).toHaveLength(0);
  });

  it('con el motor rubric_grading agenda la calificación con rúbrica y apaga el servicio viejo', async () => {
    const { service, gradingCalls, rubricBatches } = makeService(
      [[CONFIRM_BATCH_ROW], CONFIRM_SCANS, CONFIRM_MARKS, CONFIRM_STUDENTS],
      undefined,
      null,
      'rubric_grading',
    );

    await service.confirmBatch(ORG_ID, USER, BATCH_ID);

    expect(gradingCalls).toHaveLength(0);
    expect(rubricBatches).toEqual([{ orgId: ORG_ID, batchId: BATCH_ID }]);
  });

  it('si no se puede leer el motor, confirma igual y no agenda ninguna calificación', async () => {
    const reportSpy = jest
      .spyOn(observability, 'reportServerError')
      .mockImplementation(() => undefined);
    const { service, gradingCalls, rubricBatches } = makeService(
      [[CONFIRM_BATCH_ROW], CONFIRM_SCANS, CONFIRM_MARKS, CONFIRM_STUDENTS],
      undefined,
      null,
      new Error('bdd caída'),
    );

    await expect(service.confirmBatch(ORG_ID, USER, BATCH_ID)).resolves.toMatchObject({
      status: 'confirmed',
    });
    expect(gradingCalls).toHaveLength(0);
    expect(rubricBatches).toHaveLength(0);
    expect(reportSpy).toHaveBeenCalled();
    reportSpy.mockRestore();
  });

  it('no agenda corrección de desarrollo si el confirm de answer-sheets falla', async () => {
    const { db } = makeDb([[CONFIRM_BATCH_ROW], CONFIRM_SCANS, CONFIRM_MARKS, CONFIRM_STUDENTS]);
    const gradingCalls: ScheduleConfirmedBatchParams[] = [];
    const failingConfirmer: AnswerSheetConfirmer = {
      confirmParserResult: async () => {
        throw new Error('falló la ingesta');
      },
      rescoreScannedAnswer: async () => [],
      refreshResultsAfterRescore: () => undefined,
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
      makeReadingConsolidation().consolidation,
      makeRubricGrading().rubricGrading,
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
    const confirmer = createAnswerSheetConfirmer(svc, store, makeResultsFake().results);

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
    const confirmer = createAnswerSheetConfirmer(svc, store, makeResultsFake().results);
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

function makeResultsFake() {
  const recalculated: Array<{ orgId: string; assessmentIds: readonly string[] }> = [];
  const results = {
    recalculateAnswerSheetResults: async (orgId: string, assessmentIds: readonly string[]) => {
      recalculated.push({ orgId, assessmentIds });
      return [...assessmentIds];
    },
  } as unknown as AssessmentResultsService;
  return { results, recalculated };
}

describe('desambiguación con IA: lo que ve el profesor', () => {
  it('getQueue expone la resolución de IA aplicada y el conflicto, y oculta auditoría y sombra', async () => {
    const pending = [
      markQueueRow({
        markId: 'mark-conflicto',
        scanId: 'scan-read',
        aiResolution: aiResolution({
          verdict: 'conflict',
          route: 'review',
          value: null,
          applied: false,
        }),
      }),
      markQueueRow({
        markId: 'mark-auditoria',
        scanId: 'scan-read',
        fieldId: 'f2',
        printedNumber: '2',
        aiResolution: aiResolution({ verdict: 'audit_sample', route: 'review', applied: false }),
      }),
      markQueueRow({
        markId: 'mark-sombra',
        scanId: 'scan-read',
        fieldId: 'f3',
        printedNumber: '3',
        aiResolution: aiResolution({ mode: 'shadow', applied: false }),
      }),
    ];
    const auto = [
      markQueueRow({
        markId: 'mark-ia',
        scanId: 'scan-read',
        autoResolved: true,
        reviewDecision: 'option',
        reviewedValue: 'B',
        aiResolution: aiResolution(),
      }),
      markQueueRow({
        markId: 'mark-ia-solo',
        scanId: 'scan-read',
        autoResolved: true,
        reviewDecision: 'blank',
        aiResolution: aiResolution({ verdict: 'solo_b', value: 'blank' }),
      }),
      markQueueRow({
        markId: 'mark-omr',
        scanId: 'scan-read',
        state: 'multiple',
        autoResolved: true,
        reviewDecision: 'annulled',
      }),
    ];
    const { service } = makeService([
      [{ id: BATCH_ID, spec: SPEC }],
      [scanQueueRow({ scanId: 'scan-read' })],
      pending,
      auto,
    ]);

    const queue = await service.getQueue(ORG_ID, BATCH_ID);

    const byId = new Map(
      [...queue.ambiguousMarks, ...queue.autoAnnulled].map((mark) => [mark.markId, mark]),
    );
    expect(byId.get('mark-conflicto')?.aiResolution).toEqual({
      verdict: 'conflict',
      value: null,
      agreement: null,
    });
    expect(byId.get('mark-auditoria')?.aiResolution).toBeNull();
    expect(byId.get('mark-sombra')?.aiResolution).toBeNull();
    expect(byId.get('mark-ia')?.aiResolution).toEqual({
      verdict: 'agree',
      value: 'B',
      agreement: 'both',
    });
    expect(byId.get('mark-ia-solo')?.aiResolution).toEqual({
      verdict: 'solo_b',
      value: 'blank',
      agreement: 'single',
    });
    expect(byId.get('mark-omr')?.aiResolution).toBeNull();
  });

  it('resolveMark posterior deja autoResolved=false y no toca ai_resolution', async () => {
    const { service, updates } = makeService([
      [resolveMarkRow({ aiResolution: aiResolution() })],
      [{ total: 0 }],
      [{ total: 0 }],
    ]);

    const model = await service.resolveMark(ORG_ID, USER_ID, MARK_ID, {
      decision: 'option',
      reviewedValue: 'C',
    });

    expect(updates[0]).toMatchObject({ autoResolved: false, reviewedById: USER_ID });
    expect(updates[0]).not.toHaveProperty('aiResolution');
    expect(model.aiResolution).toEqual({ verdict: 'agree', value: 'B', agreement: 'both' });
  });
});

function correctionRow(overrides: Record<string, unknown> = {}) {
  return {
    mark: {
      id: MARK_ID,
      scanId: SCAN_ID,
      fieldId: 'f1',
      printedNumber: '1',
      state: 'ambiguous',
      value: null,
      fill: '0.400',
      threshold: '0.500',
      margin: '0.200',
      cropFileId: null,
      suggestedValue: 'B',
      doubtReason: 'margin',
      nullConfidence: null,
      reviewedValue: 'B',
      reviewDecision: 'option',
      reviewedById: null,
      autoResolved: true,
      aiResolution: aiResolution(),
    },
    sheetFirstName: 'Ana',
    sheetLastName: 'Pérez',
    resolvedFirstName: null,
    resolvedLastName: null,
    batchId: BATCH_ID,
    batchStatus: 'confirmed',
    scanState: 'read',
    printedSheetId: 'sheet-1',
    resolvedStudentId: null,
    sheetStudentId: STUDENT_1,
    assessmentId: ASSESSMENT_ID,
    instrumentId: INSTRUMENT_ID,
    spec: SPEC,
    ...overrides,
  };
}

const SHEET_MARKS = [
  {
    markId: MARK_ID,
    fieldId: 'f1',
    printedNumber: '1',
    state: 'ambiguous',
    value: null,
    reviewedValue: 'B',
    reviewDecision: 'option',
    reviewedAt: new Date(),
  },
  {
    markId: 'mark-2',
    fieldId: 'f2',
    printedNumber: '2',
    state: 'marked',
    value: 'A',
    reviewedValue: null,
    reviewDecision: null,
    reviewedAt: null,
  },
  {
    markId: 'mark-3',
    fieldId: 'f3',
    printedNumber: '3',
    state: 'multiple',
    value: null,
    reviewedValue: null,
    reviewDecision: 'annulled',
    reviewedAt: new Date(),
  },
];

const PAGES_READ = [{ pageIndex: 0 }, { pageIndex: 1 }];

const ASSESSMENT_LOCK = [{ id: ASSESSMENT_ID }];

describe('ScanReviewService.correctConfirmedMark (corrección tras un reclamo)', () => {
  it('rechaza una hoja que quedó incompleta al confirmar', async () => {
    const { service, updates, rescoreCalls } = makeService([
      [correctionRow()],
      ASSESSMENT_LOCK,
      SHEET_MARKS,
      [{ pageIndex: 0 }],
    ]);

    await expect(
      service.correctConfirmedMark(ORG_ID, USER_ID, MARK_ID, { decision: 'blank' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(rescoreCalls).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('reescribe la respuesta con la hoja completa, recalcula y deja la decisión como humana', async () => {
    const { service, updates, rescoreCalls } = makeService([
      [correctionRow()],
      ASSESSMENT_LOCK,
      SHEET_MARKS,
      PAGES_READ,
    ]);

    const model = await service.correctConfirmedMark(ORG_ID, USER_ID, MARK_ID, {
      decision: 'option',
      reviewedValue: 'C',
    });

    expect(rescoreCalls).toEqual([
      {
        tx: expect.anything(),
        orgId: ORG_ID,
        input: {
          assessmentId: ASSESSMENT_ID,
          instrumentId: INSTRUMENT_ID,
          studentId: STUDENT_1,
          label: '1',
          answers: { '1': 'C', '2': 'A', '3': null },
          annulledLabels: ['3'],
        },
      },
    ]);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      reviewedValue: 'C',
      reviewDecision: 'option',
      reviewedById: USER_ID,
      autoResolved: false,
    });
    expect(updates[0]).not.toHaveProperty('aiResolution');
    expect(model).toMatchObject({
      reviewedValue: 'C',
      autoResolved: false,
      studentName: 'Ana Pérez',
      aiResolution: { verdict: 'agree', value: 'B', agreement: 'both' },
    });
  });

  it('anular la respuesta la marca como anulada al reescribirla', async () => {
    const { service, rescoreCalls } = makeService([
      [correctionRow()],
      ASSESSMENT_LOCK,
      SHEET_MARKS,
      PAGES_READ,
    ]);

    await service.correctConfirmedMark(ORG_ID, USER_ID, MARK_ID, { decision: 'annulled' });

    expect(rescoreCalls[0]?.input).toMatchObject({
      answers: { '1': null, '2': 'A', '3': null },
      annulledLabels: ['1', '3'],
    });
  });

  it('rechaza un lote que todavía no está confirmado sin tocar nada', async () => {
    const { service, updates, rescoreCalls } = makeService([
      [correctionRow({ batchStatus: 'needs_review' })],
    ]);

    await expect(
      service.correctConfirmedMark(ORG_ID, USER_ID, MARK_ID, { decision: 'blank' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(rescoreCalls).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('rechaza una alternativa inexistente', async () => {
    const { service, rescoreCalls } = makeService([
      [correctionRow()],
      ASSESSMENT_LOCK,
      SHEET_MARKS,
      PAGES_READ,
    ]);

    await expect(
      service.correctConfirmedMark(ORG_ID, USER_ID, MARK_ID, {
        decision: 'option',
        reviewedValue: 'Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rescoreCalls).toHaveLength(0);
  });

  it('si la reescritura de la respuesta falla, la marca queda como estaba y no se refresca nada', async () => {
    const { db, updates } = makeDb([[correctionRow()], ASSESSMENT_LOCK, SHEET_MARKS, PAGES_READ]);
    const refreshResultsAfterRescore = jest.fn();
    const failingConfirmer: AnswerSheetConfirmer = {
      confirmParserResult: async () => ({ jobId: 'job-1', responsesCreated: 0 }),
      rescoreScannedAnswer: async () => {
        throw new ConflictException('no se registró');
      },
      refreshResultsAfterRescore,
    };
    const service = new ScanReviewService(
      db,
      failingConfirmer,
      filesServiceFake,
      {} as DevelopmentGradingService,
      makeReadingConsolidation().consolidation,
      makeRubricGrading().rubricGrading,
    );

    await expect(
      service.correctConfirmedMark(ORG_ID, USER_ID, MARK_ID, { decision: 'blank' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(updates).toHaveLength(0);
    expect(refreshResultsAfterRescore).not.toHaveBeenCalled();
  });

  it('marca, respuestas y recálculo corren en una sola transacción, con la marca y la evaluación bloqueadas', async () => {
    const { service, db, updates, rescoreCalls, refreshCalls, locks, transactions } = makeService([
      [correctionRow()],
      ASSESSMENT_LOCK,
      SHEET_MARKS,
      PAGES_READ,
    ]);

    await service.correctConfirmedMark(ORG_ID, USER_ID, MARK_ID, { decision: 'blank' });

    expect(transactions.opened).toBe(2);
    expect(rescoreCalls[0]?.tx).toBe(db);
    expect(updates).toHaveLength(1);
    expect(locks).toEqual([['update', { of: expect.anything() }], ['no key update']]);
    expect(refreshCalls).toEqual([{ orgId: ORG_ID, recalculated: [ASSESSMENT_ID] }]);
  });

  it('rechaza una marca que no está en la BD', async () => {
    const { service } = makeService([[]]);
    await expect(
      service.correctConfirmedMark(ORG_ID, USER_ID, MARK_ID, { decision: 'blank' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ScanReviewService.getCorrections', () => {
  it('lista las marcas dudosas de un lote confirmado con su resolución de IA', async () => {
    const { service } = makeService([
      [{ status: 'confirmed', spec: SPEC }],
      [scanQueueRow({ scanId: 'scan-read' })],
      [
        markQueueRow({
          markId: 'mark-ia',
          scanId: 'scan-read',
          autoResolved: true,
          reviewDecision: 'option',
          reviewedValue: 'B',
          aiResolution: aiResolution(),
        }),
        markQueueRow({ markId: 'mark-humana', scanId: 'scan-read', reviewedById: USER_ID }),
      ],
    ]);

    const corrections = await service.getCorrections(ORG_ID, BATCH_ID);

    expect(corrections.batchId).toBe(BATCH_ID);
    expect(corrections.marks.map((mark) => mark.markId)).toEqual(['mark-ia', 'mark-humana']);
    expect(corrections.marks[0]).toMatchObject({
      studentName: 'Ana Pérez',
      options: ['A', 'B', 'C', 'D'],
      aiResolution: { verdict: 'agree', agreement: 'both' },
    });
  });

  it('rechaza un lote que no está confirmado', async () => {
    const { service } = makeService([[{ status: 'needs_review', spec: SPEC }]]);
    await expect(service.getCorrections(ORG_ID, BATCH_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('createAnswerSheetConfirmer.rescoreScannedAnswer', () => {
  it('reescribe la respuesta y recalcula la evaluación con la misma transacción', async () => {
    const rescored: Array<{ tx: unknown; input: RescoreScannedAnswerInput }> = [];
    const svc = {
      rescoreScannedAnswer: async (tx: unknown, input: RescoreScannedAnswerInput) => {
        rescored.push({ tx, input });
        return 'item-1';
      },
    } as unknown as AnswerSheetsService;
    const recalculatedWithin: Array<{ tx: unknown; orgId: string; ids: readonly string[] }> = [];
    const refreshed: Array<{ orgId: string; ids: readonly string[] }> = [];
    const results = {
      recalculateAnswerSheetResultsWithin: async (
        tx: unknown,
        orgId: string,
        ids: readonly string[],
      ) => {
        recalculatedWithin.push({ tx, orgId, ids });
        return [...ids];
      },
      refreshBenchmarksAfterRecalculation: (orgId: string, ids: readonly string[]) => {
        refreshed.push({ orgId, ids });
      },
    } as unknown as AssessmentResultsService;
    const confirmer = createAnswerSheetConfirmer(svc, makePreviewStoreFake().store, results);
    const tx = makeDb([]).db;
    const input: RescoreScannedAnswerInput = {
      assessmentId: ASSESSMENT_ID,
      instrumentId: INSTRUMENT_ID,
      studentId: STUDENT_1,
      label: '1',
      answers: { '1': 'C' },
      annulledLabels: [],
    };

    const recalculated = await confirmer.rescoreScannedAnswer(tx, ORG_ID, input);
    confirmer.refreshResultsAfterRescore(ORG_ID, recalculated);

    expect(rescored).toEqual([{ tx, input }]);
    expect(recalculatedWithin).toEqual([{ tx, orgId: ORG_ID, ids: [ASSESSMENT_ID] }]);
    expect(recalculated).toEqual([ASSESSMENT_ID]);
    expect(refreshed).toEqual([{ orgId: ORG_ID, ids: [ASSESSMENT_ID] }]);
  });
});
