import { ServiceUnavailableException } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Cubre el presigner SigV4 (implementación propia con node:crypto, TKT-15):
 * estructura de la URL prefirmada, determinismo a instante fijo, y el fallback
 * 503 cuando el almacenamiento no está configurado.
 */
describe('StorageService (presigned S3)', () => {
  const ENV_KEYS = [
    'STORAGE_S3_BUCKET',
    'S3_BUCKET',
    'AWS_S3_BUCKET',
    'STORAGE_S3_REGION',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    for (const k of ENV_KEYS) delete process.env[k];
  });

  const savedFetch = global.fetch;

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    jest.useRealTimers();
    global.fetch = savedFetch;
  });

  function configureEnv() {
    process.env.STORAGE_S3_BUCKET = 'soe-instruments';
    process.env.STORAGE_S3_REGION = 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
    process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  }

  it('no está configurado y lanza 503 sin bucket/credenciales', () => {
    const svc = new StorageService();
    expect(svc.isConfigured()).toBe(false);
    expect(() =>
      svc.createUploadUrl({ key: 'k/x.pdf', contentType: 'application/pdf' }),
    ).toThrow(ServiceUnavailableException);
    expect(() => svc.createDownloadUrl({ key: 'k/x.pdf' })).toThrow(
      ServiceUnavailableException,
    );
  });

  it('genera una URL de subida PUT prefirmada con los parámetros SigV4', () => {
    configureEnv();
    const svc = new StorageService();
    const key = 'instruments/org-1/i1/enunciado/abc-enunciado.pdf';

    const res = svc.createUploadUrl({ key, contentType: 'application/pdf' });

    expect(res.method).toBe('PUT');
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.expiresIn).toBeGreaterThan(0);
    expect(res.uploadUrl).toContain(
      'https://soe-instruments.s3.us-east-1.amazonaws.com/instruments/org-1/i1/enunciado/abc-enunciado.pdf?',
    );
    expect(res.uploadUrl).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(res.uploadUrl).toContain('X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F');
    expect(res.uploadUrl).toContain('X-Amz-SignedHeaders=host');
    // La firma es un hex de 64 chars (HMAC-SHA256).
    expect(res.uploadUrl).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
    // Los '/' de la key se preservan en el path (no se codifican).
    expect(res.uploadUrl).not.toContain('%2Fenunciado%2F');
  });

  it('firma de forma determinista a un mismo instante', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-11T00:00:00.000Z'));
    configureEnv();
    const svc = new StorageService();
    const a = svc.createUploadUrl({ key: 'a/b.pdf', contentType: 'application/pdf' });
    const b = svc.createUploadUrl({ key: 'a/b.pdf', contentType: 'application/pdf' });
    expect(a.uploadUrl).toBe(b.uploadUrl);
  });

  it('incluye el token de sesión cuando existe (credenciales temporales)', () => {
    configureEnv();
    process.env.AWS_SESSION_TOKEN = 'FQoGZXIvYXdzEXAMPLETOKEN';
    const svc = new StorageService();
    const res = svc.createDownloadUrl({ key: 'a/b.pdf' });
    expect(res).toContain('X-Amz-Security-Token=');
  });

  it('toma AWS_S3_BUCKET cuando STORAGE_S3_BUCKET y S3_BUCKET no están', () => {
    process.env.AWS_S3_BUCKET = 'soe-sst-bucket';
    process.env.STORAGE_S3_REGION = 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
    process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

    const svc = new StorageService();
    expect(svc.isConfigured()).toBe(true);
    const url = svc.createDownloadUrl({ key: 'a/b.pdf' });
    expect(url).toContain('https://soe-sst-bucket.s3.us-east-1.amazonaws.com/a/b.pdf?');
  });

  // ── Operaciones server-side (deleteObject / headObject / listObjects) ────────

  /** Captura el mock de fetch como jest.Mock para inspeccionar sus llamadas. */
  function mockFetch(response: Partial<Response> & { status: number }): jest.Mock {
    const fn = jest.fn().mockResolvedValue(response);
    global.fetch = fn as unknown as typeof fetch;
    return fn;
  }

  it('deleteObject presigna un DELETE contra el host/key correcto y trata 204 como éxito', async () => {
    configureEnv();
    const svc = new StorageService();
    const fetchMock = mockFetch({ ok: true, status: 204, statusText: 'No Content' });

    await expect(svc.deleteObject('instruments/org-1/i1/x.pdf')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('DELETE');
    expect(url).toContain(
      'https://soe-instruments.s3.us-east-1.amazonaws.com/instruments/org-1/i1/x.pdf?',
    );
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
  });

  it('deleteObject es idempotente: 404 no lanza', async () => {
    configureEnv();
    const svc = new StorageService();
    mockFetch({ ok: false, status: 404, statusText: 'Not Found' });
    await expect(svc.deleteObject('k/no-existe.pdf')).resolves.toBeUndefined();
  });

  it('deleteObject lanza ante un status inesperado (403)', async () => {
    configureEnv();
    const svc = new StorageService();
    mockFetch({ ok: false, status: 403, statusText: 'Forbidden' });
    await expect(svc.deleteObject('k/x.pdf')).rejects.toThrow(/403/);
  });

  it('headObject presigna un HEAD y mapea 200 → metadatos', async () => {
    configureEnv();
    const svc = new StorageService();
    const headers = new Map<string, string>([
      ['content-length', '2048'],
      ['content-type', 'application/pdf'],
    ]);
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null } as Headers,
    });

    const meta = await svc.headObject('k/x.pdf');
    expect(meta).toEqual({ exists: true, sizeBytes: 2048, contentType: 'application/pdf' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('HEAD');
    expect(url).toContain('https://soe-instruments.s3.us-east-1.amazonaws.com/k/x.pdf?');
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
  });

  it('headObject mapea 404 → { exists: false }', async () => {
    configureEnv();
    const svc = new StorageService();
    mockFetch({ ok: false, status: 404, statusText: 'Not Found' });
    await expect(svc.headObject('k/x.pdf')).resolves.toEqual({
      exists: false,
      sizeBytes: null,
      contentType: null,
    });
  });

  it('headObject lanza ante un status inesperado (500)', async () => {
    configureEnv();
    const svc = new StorageService();
    mockFetch({ ok: false, status: 500, statusText: 'Internal Server Error' });
    await expect(svc.headObject('k/x.pdf')).rejects.toThrow(/500/);
  });

  it('listObjects presigna un GET list-type=2 contra el root del bucket y parsea el XML', async () => {
    configureEnv();
    const svc = new StorageService();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <ListBucketResult>
        <Contents><Key>p/a.pdf</Key><Size>10</Size></Contents>
        <Contents><Key>p/b.pdf</Key><Size>20</Size></Contents>
      </ListBucketResult>`;
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(xml),
    } as Partial<Response> & { status: number });

    const items = await svc.listObjects('p/');
    expect(items).toEqual([
      { key: 'p/a.pdf', sizeBytes: 10 },
      { key: 'p/b.pdf', sizeBytes: 20 },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('GET');
    // Root del bucket ('/'), no una key concreta.
    expect(url).toContain('https://soe-instruments.s3.us-east-1.amazonaws.com/?');
    expect(url).toContain('list-type=2');
    expect(url).toContain('prefix=p%2F');
  });

  it('listObjects devuelve [] para un bucket/prefijo vacío (sin <Contents>)', async () => {
    configureEnv();
    const svc = new StorageService();
    mockFetch({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('<ListBucketResult></ListBucketResult>'),
    } as Partial<Response> & { status: number });
    await expect(svc.listObjects('vacio/')).resolves.toEqual([]);
  });

  it('deleteObject/headObject lanzan 503 sin credenciales', async () => {
    const svc = new StorageService();
    expect(svc.isConfigured()).toBe(false);
    await expect(svc.deleteObject('k/x.pdf')).rejects.toThrow(ServiceUnavailableException);
    await expect(svc.headObject('k/x.pdf')).rejects.toThrow(ServiceUnavailableException);
  });
});
