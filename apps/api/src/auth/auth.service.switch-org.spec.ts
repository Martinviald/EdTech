import { ForbiddenException } from '@nestjs/common';

jest.mock('@soe/db', () => {
  const actual = jest.requireActual('@soe/db');
  return {
    __esModule: true,
    ...actual,
    getActiveMembershipsForEmailAndOrg: jest.fn(),
  };
});

import { getActiveMembershipsForEmailAndOrg } from '@soe/db';
import { AuthService } from './auth.service';
import type { JwtPayload } from './jwt-payload.types';

const mockGet = getActiveMembershipsForEmailAndOrg as jest.MockedFunction<
  typeof getActiveMembershipsForEmailAndOrg
>;

function makeService(): AuthService {
  return new AuthService({} as never);
}

function user(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    userId: 'u1',
    orgId: 'org-1',
    orgName: 'Colegio Uno',
    orgs: [
      { id: 'org-1', name: 'Colegio Uno' },
      { id: 'org-2', name: 'Colegio Dos' },
    ],
    email: 'a@b.cl',
    name: 'Test',
    isPlatformAdmin: false,
    roles: ['teacher'],
    activeRole: 'teacher',
    role: 'teacher',
    ...overrides,
  };
}

describe('AuthService.switchActiveOrg', () => {
  const svc = makeService();

  beforeEach(() => mockGet.mockReset());

  it('cambia a una org del usuario y recalcula roles/activeRole para esa org', async () => {
    mockGet.mockResolvedValue({
      organization: { id: 'org-2', name: 'Colegio Dos' } as never,
      memberships: [{ role: 'school_admin' }, { role: 'teacher' }] as never,
    });

    const result = await svc.switchActiveOrg(user(), 'org-2');

    expect(result.orgId).toBe('org-2');
    expect(result.orgName).toBe('Colegio Dos');
    expect(result.roles).toEqual(['school_admin', 'teacher']);
    // pickDefaultActiveRole elige el de mayor jerarquía.
    expect(result.activeRole).toBe('school_admin');
    expect(mockGet).toHaveBeenCalledWith(expect.anything(), 'a@b.cl', 'org-2');
  });

  it('lanza ForbiddenException si la org no está entre las del usuario (sin tocar la BD)', async () => {
    await expect(svc.switchActiveOrg(user(), 'org-ajena')).rejects.toThrow(ForbiddenException);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('lanza ForbiddenException si el membership ya no está activo en la BD', async () => {
    mockGet.mockResolvedValue(null);
    await expect(svc.switchActiveOrg(user(), 'org-2')).rejects.toThrow(ForbiddenException);
  });
});
