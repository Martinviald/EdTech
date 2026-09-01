import {
  captureSecretMatchesHash,
  deriveCaptureTokenKey,
  generateCaptureSecret,
  hashCaptureSecret,
} from './capture-token.helpers';

describe('generateCaptureSecret', () => {
  it('genera secretos base64url de al menos 32 caracteres, distintos entre sí', () => {
    const a = generateCaptureSecret();
    const b = generateCaptureSecret();

    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
  });
});

describe('hashCaptureSecret / captureSecretMatchesHash', () => {
  it('produce un sha256 hex y la comparación acepta el secreto correcto', () => {
    const secret = generateCaptureSecret();
    const hash = hashCaptureSecret(secret);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(captureSecretMatchesHash(secret, hash)).toBe(true);
  });

  it('rechaza un secreto incorrecto y un hash malformado', () => {
    const secret = generateCaptureSecret();
    const hash = hashCaptureSecret(secret);

    expect(captureSecretMatchesHash(generateCaptureSecret(), hash)).toBe(false);
    expect(captureSecretMatchesHash(secret, 'abc123')).toBe(false);
  });
});

describe('deriveCaptureTokenKey', () => {
  it('es determinista para el mismo secreto y cambia con el secreto', async () => {
    const a = await deriveCaptureTokenKey('secreto-app');
    const b = await deriveCaptureTokenKey('secreto-app');
    const c = await deriveCaptureTokenKey('otro-secreto');

    expect(a).toHaveLength(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
  });
});
