import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FEATURE_KEYS } from '@soe/types';
import type { AuthService } from '../../auth/auth.service';
import type { Database } from '../../database/database.types';
import { McpPrincipalResolver } from './mcp-principal.resolver';

function makeDb(configRows: unknown[]): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => configRows,
        }),
      }),
    }),
  } as unknown as Database;
}

function makeAuthService(result: unknown): AuthService {
  return {
    validateUser: jest.fn().mockResolvedValue(result),
  } as unknown as AuthService;
}

const baseUser = {
  id: 'user-1',
  email: 'docente@colegio.cl',
  name: 'Docente Test',
  avatarUrl: null,
  providerId: 'google-1',
};

describe('McpPrincipalResolver', () => {
  it('construye el principal con org, roles y features de la org por defecto', async () => {
    const resolver = new McpPrincipalResolver(
      makeAuthService({
        user: baseUser,
        isPlatformAdmin: false,
        isPending: false,
        roles: ['teacher', 'eval_coordinator'],
        activeRole: 'eval_coordinator',
        organization: { id: 'org-1', name: 'Colegio Test', type: 'school' },
        orgs: [{ id: 'org-1', name: 'Colegio Test' }],
        orgName: 'Colegio Test',
      }),
      makeDb([{ config: { allowedFeatures: ['benchmarking'] } }]),
    );

    const principal = await resolver.resolve('docente@colegio.cl');

    expect(principal).toMatchObject({
      userId: 'user-1',
      orgId: 'org-1',
      roles: ['teacher', 'eval_coordinator'],
      activeRole: 'eval_coordinator',
      isPlatformAdmin: false,
      features: ['benchmarking'],
      channel: 'mcp-external',
    });
  });

  it('platform_admin sin org obtiene todas las features', async () => {
    const resolver = new McpPrincipalResolver(
      makeAuthService({
        user: baseUser,
        isPlatformAdmin: true,
        isPending: false,
        roles: ['platform_admin'],
        activeRole: 'platform_admin',
        organization: null,
        orgs: [],
        orgName: null,
      }),
      makeDb([]),
    );

    const principal = await resolver.resolve('admin@academos.cl');

    expect(principal.orgId).toBeNull();
    expect(principal.features).toEqual([...FEATURE_KEYS]);
  });

  it('org sin allowedFeatures configurado habilita todo (default piloto)', async () => {
    const resolver = new McpPrincipalResolver(
      makeAuthService({
        user: baseUser,
        isPlatformAdmin: false,
        isPending: false,
        roles: ['teacher'],
        activeRole: 'teacher',
        organization: { id: 'org-1', name: 'Colegio Test', type: 'school' },
        orgs: [{ id: 'org-1', name: 'Colegio Test' }],
        orgName: 'Colegio Test',
      }),
      makeDb([{ config: {} }]),
    );

    const principal = await resolver.resolve('docente@colegio.cl');

    expect(principal.features).toEqual([...FEATURE_KEYS]);
  });

  it('rechaza con Forbidden a un usuario pendiente de activación', async () => {
    const resolver = new McpPrincipalResolver(
      makeAuthService({
        user: null,
        isPlatformAdmin: false,
        isPending: true,
        roles: ['teacher'],
        activeRole: 'teacher',
        organization: { id: 'org-1', name: 'Colegio Test', type: 'school' },
        orgs: [{ id: 'org-1', name: 'Colegio Test' }],
        orgName: 'Colegio Test',
      }),
      makeDb([]),
    );

    await expect(resolver.resolve('pendiente@colegio.cl')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('convierte NotFound (email desconocido) en Forbidden', async () => {
    const authService = {
      validateUser: jest.fn().mockRejectedValue(new NotFoundException()),
    } as unknown as AuthService;
    const resolver = new McpPrincipalResolver(authService, makeDb([]));

    await expect(resolver.resolve('desconocido@otro.cl')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
