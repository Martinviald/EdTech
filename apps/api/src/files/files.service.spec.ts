import type { Database, FileRecord } from '@soe/db';
import { FilesService } from './files.service';
import type { StorageService } from '../storage/storage.service';

// ── Stubs ────────────────────────────────────────────────────────────────────

function makeStorage(overrides: Partial<Record<keyof StorageService, unknown>> = {}) {
  const storage = {
    isConfigured: () => true,
    createUploadUrl: jest.fn(() => ({
      uploadUrl: 'https://bucket.s3.us-east-1.amazonaws.com/key?sig',
      method: 'PUT' as const,
      headers: { 'Content-Type': 'application/pdf' },
      expiresIn: 900,
    })),
    createDownloadUrl: jest.fn(() => 'https://bucket.s3.us-east-1.amazonaws.com/key?getsig'),
    deleteObject: jest.fn(() => Promise.resolve()),
    headObject: jest.fn(() =>
      Promise.resolve({ exists: true, sizeBytes: 123, contentType: 'application/pdf' }),
    ),
    ...overrides,
  };
  return storage as unknown as StorageService & {
    createUploadUrl: jest.Mock;
    createDownloadUrl: jest.Mock;
    deleteObject: jest.Mock;
    headObject: jest.Mock;
  };
}

function fileRow(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: 'file-1',
    orgId: 'org-1',
    status: 'pending',
    storageKey: 'instrument/org-1/inst-1/enunciado_pdf/uuid-enunciado.pdf',
    bucket: null,
    fileName: 'enunciado.pdf',
    mimeType: 'application/pdf',
    sizeBytes: null,
    checksum: null,
    url: null,
    ownerType: 'instrument',
    ownerId: 'inst-1',
    purpose: 'enunciado_pdf',
    note: null,
    meta: {},
    createdById: 'u1',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as FileRecord;
}

/**
 * Fake DB determinística (sin Postgres). `selectQueue` entrega el resultado de cada
 * `select()` en orden; los `insert().returning()` / `update().returning()` toman de
 * sus colas. Captura escrituras para verificar soft-deletes.
 */
class FakeDb {
  readonly inserts: unknown[] = [];
  readonly updates: unknown[] = [];

  constructor(
    private readonly selectQueue: unknown[][],
    private readonly insertReturning: unknown[][],
    private readonly updateReturning: unknown[][],
  ) {}

  execute() {
    return Promise.resolve();
  }

  transaction<T>(cb: (tx: FakeDb) => Promise<T>): Promise<T> {
    return cb(this);
  }

  select() {
    const rows = this.selectQueue.shift() ?? [];
    const chain = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      offset: () => chain,
      then: (res: (v: unknown[]) => unknown) => Promise.resolve(rows).then(res),
    };
    return chain;
  }

  insert() {
    return {
      values: (v: unknown) => {
        this.inserts.push(v);
        return { returning: () => Promise.resolve(this.insertReturning.shift() ?? []) };
      },
    };
  }

  update() {
    return {
      set: (v: unknown) => {
        this.updates.push(v);
        const result = {
          where: () => result,
          returning: () => Promise.resolve(this.updateReturning.shift() ?? []),
          then: (res: (v: unknown) => unknown) => Promise.resolve(undefined).then(res),
        };
        return result;
      },
    };
  }
}

function makeService(fake: FakeDb, storage = makeStorage()) {
  return {
    svc: new FilesService(fake as unknown as Database, storage),
    storage,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FilesService.createUploadIntent', () => {
  it('registra un archivo pending y devuelve fileId + presigned upload', async () => {
    const created = fileRow({ id: 'file-1', status: 'pending' });
    const fake = new FakeDb([], [[created]], []);
    const { svc, storage } = makeService(fake);

    const { file, upload } = await svc.createUploadIntent({
      orgId: 'org-1',
      fileName: 'enunciado.pdf',
      mimeType: 'application/pdf',
      ownerType: 'instrument',
      ownerId: 'inst-1',
      purpose: 'enunciado_pdf',
      createdById: 'u1',
    });

    expect(file.id).toBe('file-1');
    expect(upload.fileId).toBe('file-1');
    expect(upload.uploadUrl).toContain('amazonaws.com');
    // La key va namespaced por owner/org/purpose (no hardcodea dominio).
    const keyArg = storage.createUploadUrl.mock.calls[0][0].key as string;
    expect(keyArg).toMatch(/^instrument\/org-1\/inst-1\/enunciado_pdf\//);
    // El row insertado queda en estado pending.
    expect(fake.inserts[0]).toMatchObject({ status: 'pending', ownerId: 'inst-1' });
  });

  it('no inserta si el storage no está configurado (503 antes del insert)', async () => {
    const storage = makeStorage({
      isConfigured: () => false,
      createUploadUrl: jest.fn(() => {
        throw new Error('503');
      }),
    });
    const fake = new FakeDb([], [], []);
    const { svc } = makeService(fake, storage);

    await expect(
      svc.createUploadIntent({ orgId: 'org-1', fileName: 'x.pdf', mimeType: 'application/pdf' }),
    ).rejects.toThrow();
    expect(fake.inserts).toHaveLength(0);
  });
});

describe('FilesService.confirm', () => {
  it('valida en S3, marca ready y reemplaza los anteriores (sin huérfanos)', async () => {
    const pending = fileRow({ id: 'file-new', status: 'pending' });
    const stale = { id: 'file-old', storageKey: 'old/key.pdf' };
    const readyRow = fileRow({ id: 'file-new', status: 'ready' });
    const fake = new FakeDb(
      [[pending], [stale]], // 1º select: el pending; 2º select: los stale a reemplazar
      [],
      [[readyRow]], // update ... returning
    );
    const { svc, storage } = makeService(fake);

    const result = await svc.confirm({
      orgId: 'org-1',
      fileId: 'file-new',
      replaceSameOwnerPurpose: true,
    });

    expect(storage.headObject).toHaveBeenCalledWith(pending.storageKey);
    expect(result.status).toBe('ready');
    // El objeto viejo se borra de S3 (cierra el bug del huérfano).
    expect(storage.deleteObject).toHaveBeenCalledWith('old/key.pdf');
    // Se hizo el soft-delete (update con deletedAt) de los stale.
    expect(fake.updates.some((u) => (u as Record<string, unknown>).deletedAt != null)).toBe(true);
  });

  it('lanza si el objeto no existe en S3', async () => {
    const pending = fileRow({ status: 'pending' });
    const storage = makeStorage({
      headObject: jest.fn(() => Promise.resolve({ exists: false, sizeBytes: null, contentType: null })),
    });
    const fake = new FakeDb([[pending]], [], []);
    const { svc } = makeService(fake, storage);

    await expect(svc.confirm({ orgId: 'org-1', fileId: 'file-1' })).rejects.toThrow();
  });
});

describe('FilesService.remove', () => {
  it('soft-borra el registro y elimina el objeto de S3', async () => {
    const fake = new FakeDb([[{ storageKey: 'k/1.pdf' }]], [], []);
    const { svc, storage } = makeService(fake);

    await svc.remove('org-1', 'file-1');

    expect(fake.updates.some((u) => (u as Record<string, unknown>).deletedAt != null)).toBe(true);
    expect(storage.deleteObject).toHaveBeenCalledWith('k/1.pdf');
  });
});

describe('FilesService.toModel', () => {
  it('incluye downloadUrl cuando se pide y el storage está configurado', () => {
    const fake = new FakeDb([], [], []);
    const { svc } = makeService(fake);
    const model = svc.toModel(fileRow({ status: 'ready' }), true);
    expect(model.downloadUrl).toContain('amazonaws.com');
    expect(model.status).toBe('ready');
  });

  it('omite downloadUrl cuando el storage no está configurado', () => {
    const fake = new FakeDb([], [], []);
    const { svc } = makeService(fake, makeStorage({ isConfigured: () => false }));
    const model = svc.toModel(fileRow(), true);
    expect(model.downloadUrl).toBeUndefined();
  });
});
