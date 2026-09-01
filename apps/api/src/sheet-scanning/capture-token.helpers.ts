import { createHash, hkdf, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const hkdfAsync = promisify(hkdf);

const CAPTURE_TOKEN_HKDF_SALT = 'sheet-capture-token';
const CAPTURE_TOKEN_HKDF_INFO = 'AcademOS Sheet Capture Token';
const CAPTURE_TOKEN_KEY_BYTES = 32;

export type CaptureTokenClaims = {
  sessionId: string;
  orgId: string;
  printRunId: string;
  batchId: string;
  scope: string;
};

export type ActiveCaptureSession = Omit<CaptureTokenClaims, 'scope'>;

export async function deriveCaptureTokenKey(appSecret: string): Promise<Uint8Array> {
  if (appSecret.length < 16) {
    throw new Error('AUTH_SECRET ausente o demasiado corto para derivar la clave de captura');
  }
  const derived = await hkdfAsync(
    'sha256',
    appSecret,
    CAPTURE_TOKEN_HKDF_SALT,
    CAPTURE_TOKEN_HKDF_INFO,
    CAPTURE_TOKEN_KEY_BYTES,
  );
  return new Uint8Array(derived);
}

export function generateCaptureSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashCaptureSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function captureSecretMatchesHash(secret: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashCaptureSecret(secret), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}
