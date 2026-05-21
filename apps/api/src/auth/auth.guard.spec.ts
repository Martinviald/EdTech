import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import { EncryptJWT } from 'jose';
import { hkdf } from 'crypto';
import { promisify } from 'util';
import { AuthGuard } from './auth.guard';

const hkdfAsync = promisify(hkdf);
const TEST_SECRET = 'test-secret-for-unit-tests-minimum-32-chars';

async function deriveKey(secret: string): Promise<Uint8Array> {
  const derived = await hkdfAsync('sha256', secret, '', 'Auth.js Generated Encryption Key ()', 64);
  return new Uint8Array(derived);
}

async function signToken(
  payload: Record<string, unknown>,
  secret = TEST_SECRET,
  expiresIn = '1h',
): Promise<string> {
  const key = await deriveKey(secret);
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: 'dir', enc: 'A256CBC-HS512' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .encrypt(key);
}

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let mockConfig: jest.Mocked<Pick<ConfigService, 'getOrThrow'>>;
  let mockReflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;

  beforeEach(() => {
    mockConfig = { getOrThrow: jest.fn().mockReturnValue(TEST_SECRET) };
    mockReflector = { getAllAndOverride: jest.fn() };
    guard = new AuthGuard(
      mockConfig as unknown as ConfigService,
      mockReflector as unknown as Reflector,
    );
  });

  function makeContext(token?: string): { ctx: ExecutionContext; request: Record<string, unknown> } {
    const request: Record<string, unknown> = {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    };
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { ctx, request };
  }

  describe('rutas públicas (@Public)', () => {
    it('pasa sin token si la ruta está marcada @Public', async () => {
      mockReflector.getAllAndOverride.mockReturnValue(true);
      const { ctx } = makeContext();
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('rutas protegidas', () => {
    beforeEach(() => {
      mockReflector.getAllAndOverride.mockReturnValue(false);
    });

    it('rechaza con 401 si no hay token', async () => {
      const { ctx } = makeContext();
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza con 401 si el token no es un JWE válido', async () => {
      const { ctx } = makeContext('este-no-es-un-jwt');
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza con 401 si el token fue firmado con un secret diferente', async () => {
      const token = await signToken({ userId: 'u1', orgId: 'o1' }, 'otro-secret-completamente-diferente');
      const { ctx } = makeContext(token);
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza con 401 si el token está expirado', async () => {
      const token = await signToken({ userId: 'u1', orgId: 'o1' }, TEST_SECRET, '-1s');
      const { ctx } = makeContext(token);
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('acepta token válido y puebla request.user con el payload', async () => {
      const payload = {
        userId: 'dec00000-0000-0000-0000-0000000000a1',
        orgId: 'dec00000-0000-0000-0000-000000000001',
        role: 'school_admin',
        email: 'admin.demo@colegiodemo.cl',
        name: 'Admin Demo',
      };
      const token = await signToken(payload);
      const { ctx, request } = makeContext(token);

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(request.user).toMatchObject(payload);
    });

    it('acepta token sin expiración explícita (NextAuth puede omitirla en dev)', async () => {
      const key = await deriveKey(TEST_SECRET);
      const token = await new EncryptJWT({ userId: 'u1', orgId: 'o1', role: 'teacher' })
        .setProtectedHeader({ alg: 'dir', enc: 'A256CBC-HS512' })
        .setIssuedAt()
        .encrypt(key);
      const { ctx } = makeContext(token);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });
});
