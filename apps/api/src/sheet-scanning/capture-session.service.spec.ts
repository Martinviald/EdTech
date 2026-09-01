import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { jwtVerify } from 'jose';
import { captureSessions, sheetScanBatches, type Database } from '@soe/db';
import {
  CAPTURE_SESSION_MAX_CAPTURES,
  CAPTURE_SESSION_MAX_REDEEMS,
  CAPTURE_SESSION_TOKEN_SCOPE,
  DEFAULT_CAPTURE_PROFILES,
  type CaptureSessionCapture,
} from '@soe/types';
import type { FilesService } from '../files/files.service';
import type { SheetScanService } from './sheet-scan.service';
import {
  deriveCaptureTokenKey,
  generateCaptureSecret,
  hashCaptureSecret,
} from './capture-token.helpers';
import { CaptureSessionService } from './capture-session.service';

const ORG_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const BATCH_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const FILE_ID = '77777777-7777-4777-8777-777777777777';
const AUTH_SECRET = 'test-auth-secret';
const SECRET = generateCaptureSecret();

const SESSION_CTX = {
  sessionId: SESSION_ID,
  orgId: ORG_ID,
  printRunId: RUN_ID,
  batchId: BATCH_ID,
};

const CONTEXT_ROW = { courseLabel: '3°A', instrumentName: 'Prueba de Lenguaje', sheetCount: 30 };

function futureDate(): Date {
  return new Date(Date.now() + 10 * 60_000);
}

function pastDate(): Date {
  return new Date(Date.now() - 60_000);
}

function makeSessionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SESSION_ID,
    orgId: ORG_ID,
    printRunId: RUN_ID,
    batchId: BATCH_ID,
    status: 'pending',
    secretHash: hashCaptureSecret(SECRET),
    redeemCount: 0,
    captures: [] as CaptureSessionCapture[],
    expiresAt: futureDate(),
    createdById: USER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeCapture(): CaptureSessionCapture {
  return {
    fileId: FILE_ID,
    fileName: 'foto-1.jpg',
    identity: null,
    capturedAt: new Date().toISOString(),
  };
}

type RecordedInsert = { table: unknown; values: Record<string, unknown> };
type RecordedUpdate = { table: unknown; set: Record<string, unknown> };

function makeDb(
  selectResults: unknown[][],
  insertReturning: unknown[][] = [],
): { db: Database; inserts: RecordedInsert[]; updates: RecordedUpdate[] } {
  let selectIdx = 0;
  let insertIdx = 0;
  const inserts: RecordedInsert[] = [];
  const updates: RecordedUpdate[] = [];

  function chain(rows: unknown[]): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'innerJoin', 'leftJoin', 'orderBy', 'limit', 'offset']) {
      c[method] = () => c;
    }
    c.then = (resolve: (rows: unknown[]) => unknown, reject?: (err: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return c;
  }

  const db = {
    select: () => chain(selectResults[selectIdx++] ?? []),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        const rows = insertReturning[insertIdx++] ?? [];
        return {
          returning: () => Promise.resolve(rows),
          then: (resolve: (r: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(rows).then(resolve, reject),
        };
      },
    }),
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

function makeService(selectResults: unknown[][], insertReturning: unknown[][] = []) {
  const { db, inserts, updates } = makeDb(selectResults, insertReturning);
  const config = { getOrThrow: jest.fn().mockReturnValue(AUTH_SECRET) } as unknown as ConfigService;
  const createUploadIntent = jest.fn().mockResolvedValue({
    file: { id: FILE_ID },
    upload: {
      fileId: FILE_ID,
      storageKey: `sheet_scan/${FILE_ID}`,
      uploadUrl: `https://s3.example/upload/${FILE_ID}`,
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      expiresIn: 900,
    },
  });
  const confirm = jest.fn().mockResolvedValue({ id: FILE_ID });
  const filesService = { createUploadIntent, confirm } as unknown as FilesService;
  const assessCapture = jest.fn().mockResolvedValue({ accepted: true, quality: {}, identity: null });
  const startProcessing = jest.fn().mockResolvedValue({ id: BATCH_ID, status: 'processing' });
  const getBatch = jest.fn().mockResolvedValue({ id: BATCH_ID, status: 'pending' });
  const sheetScanService = { assessCapture, startProcessing, getBatch } as unknown as SheetScanService;
  const service = new CaptureSessionService(db, config, filesService, sheetScanService);
  return {
    service,
    inserts,
    updates,
    createUploadIntent,
    confirm,
    assessCapture,
    startProcessing,
    getBatch,
  };
}

describe('CaptureSessionService.create', () => {
  it('genera un secreto de al menos 32 caracteres y persiste sólo su hash', async () => {
    const { service, inserts } = makeService(
      [[{ id: RUN_ID }]],
      [[{ id: BATCH_ID }], [{ id: SESSION_ID }]],
    );

    const result = await service.create(ORG_ID, USER_ID, { printRunId: RUN_ID });

    expect(result.sessionId).toBe(SESSION_ID);
    expect(result.batchId).toBe(BATCH_ID);
    expect(result.secret.length).toBeGreaterThanOrEqual(32);
    const sessionInsert = inserts[1].values;
    expect(sessionInsert.secretHash).toBe(hashCaptureSecret(result.secret));
    expect(sessionInsert.secretHash).not.toBe(result.secret);
    expect(JSON.stringify(sessionInsert)).not.toContain(result.secret);
  });

  it('crea el lote pendiente con perfil phone y sin archivos', async () => {
    const { service, inserts } = makeService(
      [[{ id: RUN_ID }]],
      [[{ id: BATCH_ID }], [{ id: SESSION_ID }]],
    );

    await service.create(ORG_ID, USER_ID, { printRunId: RUN_ID });

    expect(inserts[0].values).toMatchObject({
      orgId: ORG_ID,
      printRunId: RUN_ID,
      status: 'pending',
      captureProfile: DEFAULT_CAPTURE_PROFILES.phone,
      sourceFileIds: [],
      createdById: USER_ID,
    });
  });

  it('rechaza con 404 una tirada inexistente', async () => {
    const { service, inserts } = makeService([[]]);

    await expect(service.create(ORG_ID, USER_ID, { printRunId: RUN_ID })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(inserts).toHaveLength(0);
  });
});

describe('CaptureSessionService.redeem', () => {
  it('canje feliz: emite un capture token verificable, activa la sesión e incrementa el contador', async () => {
    const { service, updates } = makeService([[makeSessionRow()], [CONTEXT_ROW]]);

    const result = await service.redeem({ sessionId: SESSION_ID, secret: SECRET });

    const key = await deriveCaptureTokenKey(AUTH_SECRET);
    const { payload } = await jwtVerify(result.token, key);
    expect(payload).toMatchObject({
      sessionId: SESSION_ID,
      orgId: ORG_ID,
      printRunId: RUN_ID,
      batchId: BATCH_ID,
      scope: CAPTURE_SESSION_TOKEN_SCOPE,
    });
    expect(result.context).toEqual(CONTEXT_ROW);
    expect(result.capturedCount).toBe(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].set.status).toBe('active');
    expect(updates[0].set.redeemCount).toBeDefined();
  });

  it('rechaza con 401 un secreto incorrecto sin tocar la sesión', async () => {
    const { service, updates } = makeService([[makeSessionRow()]]);

    await expect(
      service.redeem({ sessionId: SESSION_ID, secret: generateCaptureSecret() }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(updates).toHaveLength(0);
  });

  it('rechaza con 401 una sesión inexistente', async () => {
    const { service } = makeService([[]]);

    await expect(service.redeem({ sessionId: SESSION_ID, secret: SECRET })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('marca expired una sesión vencida y rechaza con 401', async () => {
    const { service, updates } = makeService([[makeSessionRow({ expiresAt: pastDate() })]]);

    await expect(service.redeem({ sessionId: SESSION_ID, secret: SECRET })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].set.status).toBe('expired');
  });

  it('rechaza con 401 una sesión revocada', async () => {
    const { service, updates } = makeService([[makeSessionRow({ status: 'revoked' })]]);

    await expect(service.redeem({ sessionId: SESSION_ID, secret: SECRET })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(updates).toHaveLength(0);
  });

  it('rechaza el canje que excede el máximo permitido', async () => {
    const { service } = makeService([
      [makeSessionRow({ status: 'active', redeemCount: CAPTURE_SESSION_MAX_REDEEMS })],
    ]);

    await expect(service.redeem({ sessionId: SESSION_ID, secret: SECRET })).rejects.toThrow(
      /máximo de usos/,
    );
  });
});

describe('CaptureSessionService.getStatus', () => {
  it('devuelve el estado con contexto de la tirada', async () => {
    const { service, updates } = makeService([
      [makeSessionRow({ status: 'active', redeemCount: 1 })],
      [CONTEXT_ROW],
    ]);

    const result = await service.getStatus(ORG_ID, SESSION_ID);

    expect(result).toMatchObject({
      id: SESSION_ID,
      status: 'active',
      batchId: BATCH_ID,
      printRunId: RUN_ID,
      redeemCount: 1,
      context: CONTEXT_ROW,
    });
    expect(updates).toHaveLength(0);
  });

  it('transiciona a expired una sesión vencida al consultarla', async () => {
    const { service, updates } = makeService([
      [makeSessionRow({ status: 'active', expiresAt: pastDate() })],
      [CONTEXT_ROW],
    ]);

    const result = await service.getStatus(ORG_ID, SESSION_ID);

    expect(result.status).toBe('expired');
    expect(updates).toHaveLength(1);
    expect(updates[0].set.status).toBe('expired');
  });
});

describe('CaptureSessionService.assess', () => {
  it('usa el printRunId de la sesión, jamás el del cliente', async () => {
    const { service, assessCapture } = makeService([]);

    await service.assess(SESSION_CTX, { imageBase64: 'imagen' });

    expect(assessCapture).toHaveBeenCalledWith(ORG_ID, {
      printRunId: RUN_ID,
      imageBase64: 'imagen',
    });
  });
});

describe('CaptureSessionService.createUploadIntent', () => {
  const DTO = {
    fileName: 'foto-1.jpg',
    mimeType: 'image/jpeg' as const,
    sizeBytes: 1024,
    identity: null,
  };

  it('rechaza con conflicto una sesión que ya no está activa', async () => {
    const { service, createUploadIntent } = makeService([
      [makeSessionRow({ status: 'closed' })],
    ]);

    await expect(service.createUploadIntent(SESSION_CTX, DTO)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(createUploadIntent).not.toHaveBeenCalled();
  });

  it('rechaza la captura 61 sin crear el intent', async () => {
    const captures = Array.from({ length: CAPTURE_SESSION_MAX_CAPTURES }, makeCapture);
    const { service, createUploadIntent } = makeService([
      [makeSessionRow({ status: 'active', captures })],
    ]);

    await expect(service.createUploadIntent(SESSION_CTX, DTO)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(createUploadIntent).not.toHaveBeenCalled();
  });

  it('rechaza con conflicto un lote que ya entró a procesamiento', async () => {
    const { service, createUploadIntent } = makeService([
      [makeSessionRow({ status: 'active' })],
      [{ status: 'processing', sourceFileIds: [] }],
    ]);

    await expect(service.createUploadIntent(SESSION_CTX, DTO)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(createUploadIntent).not.toHaveBeenCalled();
  });

  it('crea el intent y agrega el archivo al lote y la evidencia a la sesión', async () => {
    const { service, updates, createUploadIntent } = makeService([
      [makeSessionRow({ status: 'active' })],
      [{ status: 'pending', sourceFileIds: [] }],
    ]);

    const result = await service.createUploadIntent(SESSION_CTX, DTO);

    expect(createUploadIntent).toHaveBeenCalledWith({
      orgId: ORG_ID,
      fileName: DTO.fileName,
      mimeType: 'image/jpeg',
      sizeBytes: DTO.sizeBytes,
      ownerType: 'sheet_scan',
      ownerId: BATCH_ID,
      purpose: 'scan_source',
    });
    expect(result).toMatchObject({ sourceIndex: 0, fileId: FILE_ID, method: 'PUT' });
    const batchUpdate = updates.find((u) => u.table === sheetScanBatches);
    expect(batchUpdate?.set.sourceFileIds).toEqual([FILE_ID]);
    const sessionUpdate = updates.find((u) => u.table === captureSessions);
    expect(sessionUpdate?.set.captures).toEqual([
      expect.objectContaining({ fileId: FILE_ID, fileName: DTO.fileName, identity: null }),
    ]);
  });
});

describe('CaptureSessionService.confirmFile', () => {
  it('rechaza con 403 un archivo ajeno al lote de la sesión', async () => {
    const { service, confirm } = makeService([[{ sourceFileIds: ['otro-file'] }]]);

    await expect(
      service.confirmFile(SESSION_CTX, FILE_ID, { sizeBytes: 1024 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('delega la confirmación en FilesService cuando el archivo pertenece al lote', async () => {
    const { service, confirm } = makeService([[{ sourceFileIds: [FILE_ID] }]]);

    await service.confirmFile(SESSION_CTX, FILE_ID, { sizeBytes: 2048 });

    expect(confirm).toHaveBeenCalledWith({ orgId: ORG_ID, fileId: FILE_ID, sizeBytes: 2048 });
  });
});

describe('CaptureSessionService.finish', () => {
  it('cierra la sesión y dispara el procesamiento del lote', async () => {
    const { service, updates, startProcessing } = makeService([
      [makeSessionRow({ status: 'active', captures: [makeCapture()] })],
    ]);

    const result = await service.finish(ORG_ID, SESSION_ID, null);

    expect(updates[0].set.status).toBe('closed');
    expect(startProcessing).toHaveBeenCalledWith(ORG_ID, USER_ID, BATCH_ID);
    expect(result).toEqual({ batchId: BATCH_ID, batchStatus: 'processing' });
  });

  it('es idempotente: sobre una sesión cerrada no vuelve a disparar el procesamiento', async () => {
    const { service, updates, startProcessing, getBatch } = makeService([
      [makeSessionRow({ status: 'closed' })],
    ]);
    getBatch.mockResolvedValue({ id: BATCH_ID, status: 'needs_review' });

    const result = await service.finish(ORG_ID, SESSION_ID, USER_ID);

    expect(startProcessing).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(result).toEqual({ batchId: BATCH_ID, batchStatus: 'needs_review' });
  });

  it('cierra sin disparar procesamiento cuando no hay capturas', async () => {
    const { service, startProcessing, getBatch } = makeService([
      [makeSessionRow({ status: 'active', captures: [] })],
    ]);

    const result = await service.finish(ORG_ID, SESSION_ID, USER_ID);

    expect(startProcessing).not.toHaveBeenCalled();
    expect(getBatch).toHaveBeenCalledWith(ORG_ID, BATCH_ID);
    expect(result.batchStatus).toBe('pending');
  });

  it('rechaza con conflicto una sesión revocada', async () => {
    const { service } = makeService([[makeSessionRow({ status: 'revoked' })]]);

    await expect(service.finish(ORG_ID, SESSION_ID, USER_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('CaptureSessionService.revoke', () => {
  it('revoca una sesión activa y devuelve su estado', async () => {
    const { service, updates } = makeService([
      [makeSessionRow({ status: 'active' })],
      [makeSessionRow({ status: 'revoked' })],
      [CONTEXT_ROW],
    ]);

    const result = await service.revoke(ORG_ID, SESSION_ID);

    expect(updates[0].set.status).toBe('revoked');
    expect(result.status).toBe('revoked');
  });

  it('rechaza con conflicto la revocación de una sesión cerrada', async () => {
    const { service, updates } = makeService([[makeSessionRow({ status: 'closed' })]]);

    await expect(service.revoke(ORG_ID, SESSION_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(updates).toHaveLength(0);
  });
});
