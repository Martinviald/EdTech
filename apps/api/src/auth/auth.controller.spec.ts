import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';

const INTERNAL_SECRET = 'super-secret-interno';

function makeController(authOverrides: Partial<AuthService> = {}) {
  const authService = {
    validateUser: jest.fn().mockResolvedValue({ ok: true }),
    listMockUsers: jest.fn().mockResolvedValue([{ id: 'u1' }]),
    ...authOverrides,
  } as unknown as AuthService;
  const config = {
    getOrThrow: (key: string) => {
      if (key === 'INTERNAL_API_SECRET') return INTERNAL_SECRET;
      throw new Error(`Config faltante: ${key}`);
    },
    get: (key: string) => (key === 'AUTH_MODE' ? 'mock' : undefined),
  } as unknown as ConfigService;
  return { controller: new AuthController(authService, config), authService };
}

describe('AuthController — token interno', () => {
  it('rechaza cuando falta el token interno', async () => {
    const { controller } = makeController();
    await expect(controller.validateUser(undefined, { email: 'a@b.cl' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rechaza un token interno incorrecto (comparación constant-time)', async () => {
    const { controller } = makeController();
    await expect(
      controller.validateUser('token-equivocado', { email: 'a@b.cl' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('acepta el token interno correcto', async () => {
    const { controller, authService } = makeController();
    await controller.validateUser(INTERNAL_SECRET, { email: 'a@b.cl' });
    expect(authService.validateUser).toHaveBeenCalledWith('a@b.cl');
  });
});

describe('AuthController — login mock por entorno', () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it('deshabilita mock-users en producción aunque el token sea válido', async () => {
    process.env.NODE_ENV = 'production';
    const { controller } = makeController();
    await expect(controller.listMockUsers(INTERNAL_SECRET)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('permite mock-users fuera de producción', async () => {
    process.env.NODE_ENV = 'test';
    const { controller, authService } = makeController();
    await controller.listMockUsers(INTERNAL_SECRET);
    expect(authService.listMockUsers).toHaveBeenCalled();
  });
});
