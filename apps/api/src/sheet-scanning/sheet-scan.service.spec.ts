import { BadRequestException, NotFoundException } from '@nestjs/common';
import { sheetScanBatches, sheetScanMarks, sheetScans, type Database } from '@soe/db';
import {
  DEFAULT_CAPTURE_PROFILES,
  buildOmrQrPayload,
  type LayoutSpec,
  type MarkReading,
  type ScannedPage,
} from '@soe/types';
import * as observability from '../common/observability/report-error';
import type { FilesService } from '../files/files.service';
import type { EnqueuedJob, JobDispatcher } from '../jobs/job-dispatcher';
import type { IdentityCandidate } from './identity/identity-resolver.types';
import type { QrIdentityResolver } from './identity/qr-identity.resolver';
import { OmrServiceUnavailableError } from './omr-client.types';
import { FakeOmrClient } from './testing/fake-omr-client';
import { SheetScanService } from './sheet-scan.service';

const ORG_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const BATCH_ID = '44444444-4444-4444-8444-444444444444';
const RUN_ID = '55555555-5555-4555-8555-555555555555';
const FILE_ID = '66666666-6666-4666-8666-666666666666';
const SHEET_1 = '77777777-7777-4777-8777-777777777777';
const SHEET_2 = '88888888-8888-4888-8888-888888888888';
const STUDENT_1 = '99999999-9999-4999-8999-999999999999';
const STUDENT_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LAYOUT_HASH = 'a3f9c1e70b4d2856';

const PROFILE = DEFAULT_CAPTURE_PROFILES.scanner;
const SPEC = { specVersion: 1, pageCount: 2 } as unknown as LayoutSpec;

const CTX_ROW = { sourceFileIds: [FILE_ID], captureProfile: PROFILE, spec: SPEC };
const FILE_ROW = {
  id: FILE_ID,
  mimeType: 'application/pdf',
  storageKey: 'sheet_scan/k',
  fileName: 'lote.pdf',
};

const BATCH_ROW = {
  id: BATCH_ID,
  printRunId: RUN_ID,
  status: 'processing',
  captureProfile: PROFILE,
  pagesTotal: null,
  pagesRead: 0,
  reviewPending: 0,
  failureReason: null,
  createdAt: new Date('2026-08-20T12:00:00Z'),
  updatedAt: new Date('2026-08-20T12:00:00Z'),
  sheetCount: 30,
};

type QueryChain = {
  from: (..._: unknown[]) => QueryChain;
  where: (..._: unknown[]) => QueryChain;
  innerJoin: (..._: unknown[]) => QueryChain;
  leftJoin: (..._: unknown[]) => QueryChain;
  orderBy: (..._: unknown[]) => QueryChain;
  groupBy: (..._: unknown[]) => QueryChain;
  limit: (..._: unknown[]) => QueryChain;
  offset: (..._: unknown[]) => QueryChain;
  then: <T>(resolve: (rows: unknown[]) => T, reject?: (err: unknown) => unknown) => Promise<T>;
};

type RecordedInsert = { table: unknown; values: unknown };
type RecordedUpdate = { table: unknown; set: Record<string, unknown> };

function makeDb(
  selectResults: unknown[][],
  insertReturning: unknown[][] = [],
): { db: Database; inserts: RecordedInsert[]; updates: RecordedUpdate[] } {
  let selectIdx = 0;
  let insertIdx = 0;
  const inserts: RecordedInsert[] = [];
  const updates: RecordedUpdate[] = [];

  function chain(rows: unknown[]): QueryChain {
    const c: QueryChain = {
      from: () => c,
      where: () => c,
      innerJoin: () => c,
      leftJoin: () => c,
      orderBy: () => c,
      groupBy: () => c,
      limit: () => c,
      offset: () => c,
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) as never,
    };
    return c;
  }

  const db = {
    select: () => chain(selectResults[selectIdx++] ?? []),
    insert: (table: unknown) => {
      const rows = insertReturning[insertIdx++] ?? [];
      return {
        values: (values: unknown) => {
          inserts.push({ table, values });
          return {
            returning: () => Promise.resolve(rows),
            then: (resolve: (r: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
              Promise.resolve(rows).then(resolve, reject),
          };
        },
      };
    },
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => {
        updates.push({ table, set });
        return { where: () => Promise.resolve([]) };
      },
    }),
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  } as unknown as Database;

  return { db, inserts, updates };
}

class FakeDispatcher implements JobDispatcher {
  readonly jobs: EnqueuedJob[] = [];

  enqueue(job: EnqueuedJob): void {
    this.jobs.push(job);
  }
}

function makeFilesService(): {
  filesService: FilesService;
  createUploadIntent: jest.Mock;
  confirm: jest.Mock;
} {
  let intentIdx = 0;
  const createUploadIntent = jest.fn().mockImplementation(() => {
    const fileId = `file-${intentIdx++}`;
    return Promise.resolve({
      file: { id: fileId },
      upload: {
        fileId,
        storageKey: `sheet_scan/${fileId}`,
        uploadUrl: `https://s3.example/upload/${fileId}`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        expiresIn: 900,
      },
    });
  });
  const confirm = jest.fn().mockResolvedValue({});
  const filesService = {
    createUploadIntent,
    confirm,
    buildDownloadUrl: jest.fn().mockReturnValue('https://s3.example/signed/source'),
  } as unknown as FilesService;
  return { filesService, createUploadIntent, confirm };
}

function makeService(
  selectResults: unknown[][],
  insertReturning: unknown[][] = [],
): {
  service: SheetScanService;
  inserts: RecordedInsert[];
  updates: RecordedUpdate[];
  resolve: jest.Mock;
  omr: FakeOmrClient;
  dispatcher: FakeDispatcher;
  createUploadIntent: jest.Mock;
  confirm: jest.Mock;
} {
  const { db, inserts, updates } = makeDb(selectResults, insertReturning);
  const { filesService, createUploadIntent, confirm } = makeFilesService();
  const resolve = jest.fn();
  const resolver = { mode: 'qr', resolve } as unknown as QrIdentityResolver;
  const omr = new FakeOmrClient();
  const dispatcher = new FakeDispatcher();
  const service = new SheetScanService(db, filesService, resolver, omr, dispatcher);
  return { service, inserts, updates, resolve, omr, dispatcher, createUploadIntent, confirm };
}

function makePage(overrides: Partial<ScannedPage> = {}): ScannedPage {
  return {
    pageIndex: 0,
    imageSha256: 'a'.repeat(64),
    quality: { ok: true, sharpness: 0.9, glare: 0.05, fiducialsFound: 4, rejectReason: null },
    identity: { mode: 'qr', raw: null, confidence: 1 },
    marks: [],
    pageThumbJpegBase64: null,
    ...overrides,
  };
}

function makeMark(overrides: Partial<MarkReading> = {}): MarkReading {
  return {
    fieldId: 'item-1',
    printedNumber: '1',
    state: 'marked',
    value: 'A',
    fill: 0.82,
    threshold: 0.41,
    margin: 1,
    cropJpegBase64: null,
    ...overrides,
  };
}

function qrRaw(printedSheetId: string, pageIndex: number, pageCount = 2): string {
  return buildOmrQrPayload({ printedSheetId, layoutHash: LAYOUT_HASH, pageIndex, pageCount });
}

function candidate(overrides: Partial<IdentityCandidate> = {}): IdentityCandidate {
  return {
    printedSheetId: SHEET_1,
    studentId: STUDENT_1,
    confidence: 1,
    evidence: {},
    needsHumanConfirmation: false,
    batchRejection: null,
    ...overrides,
  };
}

function runJob(service: SheetScanService): Promise<void> {
  return service['runJob'](ORG_ID, USER_ID, BATCH_ID);
}

const CREATE_DTO = {
  printRunId: RUN_ID,
  captureProfile: PROFILE,
  sources: [
    { fileName: 'lote.pdf', mimeType: 'application/pdf', sizeBytes: 1000 },
    { fileName: 'foto.jpg', mimeType: 'image/jpeg', sizeBytes: 500 },
  ],
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('SheetScanService.createBatch', () => {
  it('crea el lote pending con un upload intent por source y persiste los sourceFileIds', async () => {
    const { service, inserts, updates, createUploadIntent } = makeService(
      [[{ id: RUN_ID }]],
      [[{ id: BATCH_ID }]],
    );

    const result = await service.createBatch(ORG_ID, USER_ID, CREATE_DTO);

    expect(result.batchId).toBe(BATCH_ID);
    expect(result.uploads).toHaveLength(2);
    expect(result.uploads[0]).toEqual({
      sourceIndex: 0,
      fileId: 'file-0',
      uploadUrl: 'https://s3.example/upload/file-0',
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      expiresIn: 900,
    });
    expect(inserts[0].table).toBe(sheetScanBatches);
    expect(inserts[0].values).toMatchObject({
      orgId: ORG_ID,
      printRunId: RUN_ID,
      status: 'pending',
      createdById: USER_ID,
    });
    expect(createUploadIntent).toHaveBeenCalledTimes(2);
    expect(createUploadIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG_ID,
        ownerType: 'sheet_scan',
        ownerId: BATCH_ID,
        purpose: 'scan_source',
      }),
    );
    expect(updates[0].set.sourceFileIds).toEqual(['file-0', 'file-1']);
  });

  it('rechaza con 400 un mimeType no soportado sin tocar la base', async () => {
    const { service, inserts, createUploadIntent } = makeService([]);

    await expect(
      service.createBatch(ORG_ID, USER_ID, {
        ...CREATE_DTO,
        sources: [{ fileName: 'lote.tiff', mimeType: 'image/tiff', sizeBytes: 100 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(inserts).toHaveLength(0);
    expect(createUploadIntent).not.toHaveBeenCalled();
  });

  it('lanza NotFound cuando la tirada no existe en la org', async () => {
    const { service } = makeService([[]]);

    await expect(service.createBatch(ORG_ID, USER_ID, CREATE_DTO)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('SheetScanService.startProcessing / retry', () => {
  it('marca processing y encola el job sheet_scan cuando todos los archivos están ready', async () => {
    const { service, updates, dispatcher } = makeService([
      [{ status: 'pending', sourceFileIds: [FILE_ID] }],
      [{ id: FILE_ID, status: 'ready' }],
      [BATCH_ROW],
      [],
      [],
      [],
    ]);

    const result = await service.startProcessing(ORG_ID, USER_ID, BATCH_ID);

    expect(updates[0].set).toMatchObject({ status: 'processing', failureReason: null });
    expect(dispatcher.jobs).toHaveLength(1);
    expect(dispatcher.jobs[0]).toMatchObject({ id: BATCH_ID, kind: 'sheet_scan' });
    expect(result.status).toBe('processing');
  });

  it('rechaza con 400 cuando hay archivos sin confirmar y no encola nada', async () => {
    const { service, dispatcher } = makeService([
      [{ status: 'pending', sourceFileIds: [FILE_ID, 'otro-file'] }],
      [
        { id: FILE_ID, status: 'ready' },
        { id: 'otro-file', status: 'pending' },
      ],
    ]);

    await expect(service.startProcessing(ORG_ID, USER_ID, BATCH_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(dispatcher.jobs).toHaveLength(0);
  });

  it('rechaza con 400 iniciar un lote que ya está processing', async () => {
    const { service, dispatcher } = makeService([
      [{ status: 'processing', sourceFileIds: [FILE_ID] }],
    ]);

    await expect(service.startProcessing(ORG_ID, USER_ID, BATCH_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(dispatcher.jobs).toHaveLength(0);
  });

  it('retry re-encola desde failed sin re-subir archivos', async () => {
    const { service, updates, dispatcher } = makeService([
      [{ status: 'failed', sourceFileIds: [FILE_ID] }],
      [{ id: FILE_ID, status: 'ready' }],
      [BATCH_ROW],
      [],
      [],
      [],
    ]);

    await service.retry(ORG_ID, USER_ID, BATCH_ID);

    expect(updates[0].set).toMatchObject({ status: 'processing', failureReason: null });
    expect(dispatcher.jobs).toHaveLength(1);
    expect(dispatcher.jobs[0].kind).toBe('sheet_scan');
  });

  it('retry rechaza con 400 un lote que no está failed', async () => {
    const { service, dispatcher } = makeService([
      [{ status: 'needs_review', sourceFileIds: [FILE_ID] }],
    ]);

    await expect(service.retry(ORG_ID, USER_ID, BATCH_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(dispatcher.jobs).toHaveLength(0);
  });
});

describe('SheetScanService job', () => {
  it('lote feliz multipágina: persiste scans y marks y deja el lote needs_review con contadores', async () => {
    const { service, inserts, updates, resolve, omr } = makeService([
      [CTX_ROW],
      [FILE_ROW],
      [],
      [],
      [{ state: 'read', count: 2 }],
      [{ count: 1 }],
    ]);
    omr.enqueueResponse({
      pages: [
        makePage({
          pageIndex: 0,
          imageSha256: 'a'.repeat(64),
          identity: { mode: 'qr', raw: qrRaw(SHEET_1, 1), confidence: 1 },
          marks: [
            makeMark(),
            makeMark({ fieldId: 'item-2', printedNumber: '2', state: 'ambiguous', value: null }),
          ],
        }),
        makePage({
          pageIndex: 1,
          imageSha256: 'b'.repeat(64),
          identity: { mode: 'qr', raw: qrRaw(SHEET_2, 0), confidence: 1 },
          marks: [makeMark({ fieldId: 'item-3', printedNumber: '3' })],
        }),
      ],
    });
    resolve.mockResolvedValueOnce(candidate());
    resolve.mockResolvedValueOnce(candidate({ printedSheetId: SHEET_2, studentId: STUDENT_2 }));

    await runJob(service);

    expect(inserts).toHaveLength(4);
    expect(inserts[0].table).toBe(sheetScans);
    expect(inserts[0].values).toMatchObject({
      orgId: ORG_ID,
      batchId: BATCH_ID,
      printedSheetId: SHEET_1,
      pageIndex: 1,
      sourceFileId: FILE_ID,
      sourcePageIndex: 0,
      imageHash: 'a'.repeat(64),
      state: 'read',
      resolvedStudentId: STUDENT_1,
      identityConfidence: '1.000',
      supersedesId: null,
    });
    expect(inserts[1].table).toBe(sheetScanMarks);
    const marks = inserts[1].values as Array<Record<string, unknown>>;
    expect(marks).toHaveLength(2);
    expect(marks[0]).toMatchObject({
      orgId: ORG_ID,
      fieldId: 'item-1',
      printedNumber: '1',
      state: 'marked',
      value: 'A',
      fill: '0.820',
      threshold: '0.410',
      margin: '1.000',
      cropFileId: null,
    });
    expect(marks[1]).toMatchObject({ state: 'ambiguous', value: null });
    expect(inserts[2].values).toMatchObject({
      printedSheetId: SHEET_2,
      pageIndex: 0,
      sourcePageIndex: 1,
      state: 'read',
    });

    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe(sheetScanBatches);
    expect(updates[0].set).toMatchObject({
      status: 'needs_review',
      pagesTotal: 2,
      pagesRead: 2,
      reviewPending: 1,
      failureReason: null,
    });
  });

  it('hash de layout distinto: rechaza el lote entero con el motivo exacto y no persiste nada', async () => {
    const reason =
      'El instrumento fue editado después de imprimir las hojas: reimprime y vuelve a escanear.';
    const { service, inserts, updates, resolve, omr } = makeService([[CTX_ROW], [FILE_ROW]]);
    omr.enqueueResponse({
      pages: [
        makePage({ identity: { mode: 'qr', raw: qrRaw(SHEET_1, 0), confidence: 1 } }),
        makePage({ pageIndex: 1 }),
      ],
    });
    resolve.mockResolvedValue(
      candidate({ studentId: null, confidence: 0, batchRejection: { reason } }),
    );

    await runJob(service);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toMatchObject({ status: 'rejected', failureReason: reason });
  });

  it('quality.ok false: la página queda quality_rejected y las demás se leen igual', async () => {
    const { service, inserts, updates, resolve, omr } = makeService([
      [CTX_ROW],
      [FILE_ROW],
      [],
      [],
      [
        { state: 'read', count: 1 },
        { state: 'quality_rejected', count: 1 },
      ],
      [{ count: 0 }],
    ]);
    omr.enqueueResponse({
      pages: [
        makePage({
          quality: { ok: false, sharpness: 0.1, glare: 0.1, fiducialsFound: 4, rejectReason: 'blurry' },
          identity: { mode: 'qr', raw: qrRaw(SHEET_1, 0), confidence: 1 },
        }),
        makePage({
          pageIndex: 1,
          imageSha256: 'b'.repeat(64),
          identity: { mode: 'qr', raw: qrRaw(SHEET_2, 0), confidence: 1 },
          marks: [makeMark()],
        }),
      ],
    });
    resolve.mockResolvedValueOnce(candidate());
    resolve.mockResolvedValueOnce(candidate({ printedSheetId: SHEET_2, studentId: STUDENT_2 }));

    await runJob(service);

    expect(inserts[0].values).toMatchObject({ state: 'quality_rejected', printedSheetId: SHEET_1 });
    expect(inserts[1].values).toMatchObject({ state: 'read', printedSheetId: SHEET_2 });
    expect(updates[0].set).toMatchObject({
      status: 'needs_review',
      pagesRead: 1,
      reviewPending: 1,
    });
  });

  it('QR ilegible: el escaneo queda identity_unresolved sin hoja y con pageIndex de fallback', async () => {
    const { service, inserts, resolve, omr } = makeService([
      [CTX_ROW],
      [FILE_ROW],
      [{ state: 'identity_unresolved', count: 1 }],
      [{ count: 0 }],
    ]);
    omr.enqueueResponse({
      pages: [makePage({ pageIndex: 3, identity: { mode: 'qr', raw: null, confidence: 0 } })],
    });
    resolve.mockResolvedValueOnce(
      candidate({ printedSheetId: null, studentId: null, confidence: 0, needsHumanConfirmation: true }),
    );

    await runJob(service);

    expect(inserts[0].values).toMatchObject({
      state: 'identity_unresolved',
      printedSheetId: null,
      resolvedStudentId: null,
      pageIndex: 3,
      sourcePageIndex: 3,
    });
  });

  it('hoja de reserva: identity_unresolved conservando el printedSheetId', async () => {
    const { service, inserts, updates, resolve, omr } = makeService([
      [CTX_ROW],
      [FILE_ROW],
      [],
      [{ state: 'identity_unresolved', count: 1 }],
      [{ count: 0 }],
    ]);
    omr.enqueueResponse({
      pages: [makePage({ identity: { mode: 'qr', raw: qrRaw(SHEET_1, 0), confidence: 1 } })],
    });
    resolve.mockResolvedValueOnce(
      candidate({ studentId: null, confidence: 0, needsHumanConfirmation: true }),
    );

    await runJob(service);

    expect(inserts[0].values).toMatchObject({
      state: 'identity_unresolved',
      printedSheetId: SHEET_1,
      resolvedStudentId: null,
    });
    expect(updates[0].set).toMatchObject({ status: 'needs_review', reviewPending: 1 });
  });

  it('reproceso idempotente: mismo hash se salta, hash nuevo supersede al anterior', async () => {
    const { service, inserts, updates, resolve, omr } = makeService([
      [CTX_ROW],
      [FILE_ROW],
      [{ id: 'scan-viejo-1', imageHash: 'a'.repeat(64), state: 'read' }],
      [{ id: 'scan-viejo-2', imageHash: 'c'.repeat(64), state: 'read' }],
      [{ state: 'read', count: 2 }],
      [{ count: 0 }],
    ]);
    omr.enqueueResponse({
      pages: [
        makePage({ identity: { mode: 'qr', raw: qrRaw(SHEET_1, 0), confidence: 1 } }),
        makePage({
          pageIndex: 1,
          imageSha256: 'b'.repeat(64),
          identity: { mode: 'qr', raw: qrRaw(SHEET_2, 0), confidence: 1 },
        }),
      ],
    });
    resolve.mockResolvedValueOnce(candidate());
    resolve.mockResolvedValueOnce(candidate({ printedSheetId: SHEET_2, studentId: STUDENT_2 }));

    await runJob(service);

    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toMatchObject({
      printedSheetId: SHEET_2,
      imageHash: 'b'.repeat(64),
      supersedesId: 'scan-viejo-2',
    });
    expect(updates[0].table).toBe(sheetScans);
    expect(updates[0].set).toEqual({ state: 'superseded' });
    expect(updates[1].set).toMatchObject({ status: 'needs_review' });
  });

  it('OmrServiceUnavailableError deja el lote failed con mensaje reintentable, sin reportServerError', async () => {
    const reportSpy = jest.spyOn(observability, 'reportServerError').mockImplementation(() => undefined);
    const { service, updates, omr } = makeService([[CTX_ROW], [FILE_ROW]]);
    omr.enqueueResponse(new OmrServiceUnavailableError('HTTP 502'));

    await runJob(service);

    expect(updates).toHaveLength(1);
    expect(updates[0].set).toMatchObject({ status: 'failed' });
    expect(updates[0].set.failureReason).toContain('Reintenta');
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it('un error inesperado deja el lote failed y llama reportServerError con contexto', async () => {
    const reportSpy = jest.spyOn(observability, 'reportServerError').mockImplementation(() => undefined);
    const { service, updates, omr } = makeService([[CTX_ROW], [FILE_ROW]]);
    const boom = new Error('boom');
    omr.enqueueResponse(boom);

    await runJob(service);

    expect(updates[0].set).toMatchObject({ status: 'failed' });
    expect(reportSpy).toHaveBeenCalledWith(boom, {
      batchId: BATCH_ID,
      orgId: ORG_ID,
      userId: USER_ID,
    });
  });

  it('persiste la evidencia CD-1 del recorte vía FilesService y guarda el cropFileId', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    const { service, inserts, resolve, omr, createUploadIntent, confirm } = makeService([
      [CTX_ROW],
      [FILE_ROW],
      [],
      [{ state: 'read', count: 1 }],
      [{ count: 1 }],
    ]);
    omr.enqueueResponse({
      pages: [
        makePage({
          identity: { mode: 'qr', raw: qrRaw(SHEET_1, 0), confidence: 1 },
          marks: [
            makeMark({ state: 'ambiguous', value: null, cropJpegBase64: 'aGVsbG8=' }),
          ],
        }),
      ],
    });
    resolve.mockResolvedValueOnce(candidate());

    await runJob(service);

    expect(createUploadIntent).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: 'sheet_scan_mark', purpose: 'mark_crop' }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://s3.example/upload/file-0',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG_ID, fileId: 'file-0' }));
    const marks = inserts[1].values as Array<Record<string, unknown>>;
    expect(marks[0]).toMatchObject({ cropFileId: 'file-0' });
  });
});

describe('SheetScanService.getBatch', () => {
  it('devuelve el BatchStatusModel con contadores agregados por estado', async () => {
    const { service } = makeService([
      [{ ...BATCH_ROW, status: 'needs_review', pagesTotal: 3, pagesRead: 2, reviewPending: 3 }],
      [
        { batchId: BATCH_ID, state: 'read', count: 2 },
        { batchId: BATCH_ID, state: 'quality_rejected', count: 1 },
      ],
      [
        { batchId: BATCH_ID, state: 'marked', count: 10 },
        { batchId: BATCH_ID, state: 'ambiguous', count: 2 },
      ],
      [{ batchId: BATCH_ID, count: 2 }],
    ]);

    const model = await service.getBatch(ORG_ID, BATCH_ID);

    expect(model).toMatchObject({
      id: BATCH_ID,
      printRunId: RUN_ID,
      status: 'needs_review',
      pagesTotal: 3,
      pagesRead: 2,
      reviewPending: 3,
      failureReason: null,
    });
    expect(model.counters).toEqual({
      marks: { marked: 10, blank: 0, multiple: 0, ambiguous: 2 },
      scans: { read: 2, quality_rejected: 1, identity_unresolved: 0, superseded: 0 },
      sheetsExpected: 30,
      sheetsScanned: 2,
    });
  });

  it('lanza NotFound cuando el lote no existe en la org', async () => {
    const { service } = makeService([[]]);

    await expect(service.getBatch(ORG_ID, BATCH_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SheetScanService.list', () => {
  it('devuelve la envoltura paginada con contadores por lote sin N+1', async () => {
    const { service } = makeService([
      [{ total: 7 }],
      [BATCH_ROW],
      [{ batchId: BATCH_ID, state: 'read', count: 4 }],
      [],
      [{ batchId: BATCH_ID, count: 4 }],
    ]);

    const result = await service.list(ORG_ID, { page: 2, limit: 5 });

    expect(result.total).toBe(7);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(5);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].counters.scans.read).toBe(4);
    expect(result.data[0].counters.sheetsExpected).toBe(30);
    expect(result.data[0].counters.sheetsScanned).toBe(4);
  });
});
