import { ForbiddenException, Logger } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { UserRole } from '@soe/types';
import { RolesGuard } from './roles.guard';
import type { JwtPayload } from '../../auth/jwt-payload.types';

function mockContext(user: JwtPayload): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ user, method: 'GET', url: '/organizations/me' }),
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(required: UserRole[] | undefined): RolesGuard {
  return new RolesGuard({ getAllAndOverride: () => required } as unknown as Reflector);
}

const coordinator: JwtPayload = {
  userId: 'u1',
  orgId: 'org-1',
  email: 'coordinacion@colegio.cl',
  name: 'Coordinación',
  isPlatformAdmin: false,
  roles: ['coordinator'],
  activeRole: 'coordinator',
  role: 'coordinator',
};

describe('RolesGuard', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it('deja pasar cuando el endpoint no declara roles', () => {
    expect(makeGuard(undefined).canActivate(mockContext(coordinator))).toBe(true);
  });

  it('autoriza si alguno de los roles del usuario está permitido', () => {
    const user = { ...coordinator, roles: ['coordinator', 'teacher'] as UserRole[] };
    expect(makeGuard(['teacher']).canActivate(mockContext(user))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('rechaza y deja registro de quién, en qué ruta y con qué roles', () => {
    expect(() => makeGuard(['school_admin']).canActivate(mockContext(coordinator))).toThrow(
      ForbiddenException,
    );
    const logged = JSON.parse(warn.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(logged).toEqual({
      event: 'role_denied',
      method: 'GET',
      url: '/organizations/me',
      userId: 'u1',
      orgId: 'org-1',
      roles: ['coordinator'],
      required: ['school_admin'],
    });
  });

  it('los platform_admin pasan sin importar los roles', () => {
    const admin = { ...coordinator, isPlatformAdmin: true };
    expect(makeGuard(['school_admin']).canActivate(mockContext(admin))).toBe(true);
  });
});
