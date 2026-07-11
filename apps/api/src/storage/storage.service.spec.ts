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

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    jest.useRealTimers();
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
});
