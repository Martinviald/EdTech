import { ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { JwtPayload } from './jwt-payload.types';

function makeService(): AuthService {
  // El método switchActiveRole es puro: no toca la DB. Pasamos un db dummy.
  return new AuthService({} as never);
}

function user(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    userId: 'u1',
    orgId: 'org-1',
    orgName: 'Colegio Uno',
    orgs: [{ id: 'org-1', name: 'Colegio Uno' }],
    email: 'a@b.cl',
    name: 'Test',
    isPlatformAdmin: false,
    roles: ['teacher', 'eval_coordinator'],
    activeRole: 'teacher',
    role: 'teacher',
    ...overrides,
  };
}

describe('AuthService.switchActiveRole', () => {
  const svc = makeService();

  it('permite cambiar a un rol que está en roles[]', () => {
    const result = svc.switchActiveRole(user(), 'eval_coordinator');
    expect(result.activeRole).toBe('eval_coordinator');
    expect(result.roles).toEqual(['teacher', 'eval_coordinator']);
  });

  it('lanza ForbiddenException si el rol no está asignado al usuario', () => {
    expect(() => svc.switchActiveRole(user(), 'school_admin')).toThrow(ForbiddenException);
  });

  it('permite mantener el rol activo actual (no-op)', () => {
    const result = svc.switchActiveRole(user(), 'teacher');
    expect(result.activeRole).toBe('teacher');
  });

  it('platform_admin con membership extra puede alternar entre platform_admin y school_admin', () => {
    const u = user({
      isPlatformAdmin: true,
      roles: ['platform_admin', 'school_admin'],
      activeRole: 'platform_admin',
      role: 'platform_admin',
    });
    expect(svc.switchActiveRole(u, 'school_admin').activeRole).toBe('school_admin');
    expect(svc.switchActiveRole(u, 'platform_admin').activeRole).toBe('platform_admin');
  });
});
