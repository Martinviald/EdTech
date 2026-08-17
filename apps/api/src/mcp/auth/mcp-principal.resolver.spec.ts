import { ForbiddenException, NotFoundException } from '@nestjs/common';

jest.mock('@soe/db', () => ({
  ...jest.requireActual('@soe/db'),
  getActiveMembershipsForEmailAndOrg: jest.fn(),
  listActiveOrgsWithMembershipsByEmail: jest.fn(),
}));

import {
  getActiveMembershipsForEmailAndOrg,
  listActiveOrgsWithMembershipsByEmail,
  mcpUserActiveOrg,
} from '@soe/db';
import { FEATURE_KEYS } from '@soe/types';
import type { AuthService } from '../../auth/auth.service';
import type { Database } from '../../database/database.types';
import { McpPrincipalResolver } from './mcp-principal.resolver';

const mockGetActiveMemberships = getActiveMembershipsForEmailAndOrg as jest.Mock;
const mockListOrgs = listActiveOrgsWithMembershipsByEmail as jest.Mock;

interface DbOpts {
  activeOrgId?: string | null;
  orgConfig?: Record<string, unknown> | null;
}

function makeDb(opts: DbOpts = {}): { db: Database; deleted: string[] } {
  const deleted: string[] = [];
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () =>
            table === mcpUserActiveOrg
              ? opts.activeOrgId
                ? [{ orgId: opts.activeOrgId }]
                : []
              : [{ config: opts.orgConfig ?? {} }],
        }),
      }),
    }),
    delete: () => ({
      where: async () => {
        deleted.push('cleared');
      },
    }),
  } as unknown as Database;
  return { db, deleted };
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

const realUserResult = {
  user: baseUser,
  isPlatformAdmin: false,
  isPending: false,
  roles: ['teacher', 'eval_coordinator'],
  activeRole: 'eval_coordinator',
  organization: { id: 'org-1', name: 'Colegio Test', type: 'school' },
  orgs: [
    { id: 'org-1', name: 'Colegio Test' },
    { id: 'org-2', name: 'Colegio Dos' },
  ],
  orgName: 'Colegio Test',
};

beforeEach(() => {
  mockGetActiveMemberships.mockReset();
  mockListOrgs.mockReset();
});

describe('McpPrincipalResolver', () => {
  it('construye el principal con org, roles y features de la org por defecto', async () => {
    const { db } = makeDb({ orgConfig: { allowedFeatures: ['benchmarking'] } });
    const resolver = new McpPrincipalResolver(makeAuthService(realUserResult), db);

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
    const { db } = makeDb();
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
      db,
    );

    const principal = await resolver.resolve('admin@academos.cl');

    expect(principal.orgId).toBeNull();
    expect(principal.features).toEqual([...FEATURE_KEYS]);
  });

  it('org sin allowedFeatures configurado habilita todo (default piloto)', async () => {
    const { db } = makeDb({ orgConfig: {} });
    const resolver = new McpPrincipalResolver(
      makeAuthService({
        ...realUserResult,
        roles: ['teacher'],
        activeRole: 'teacher',
        orgs: [{ id: 'org-1', name: 'Colegio Test' }],
      }),
      db,
    );

    const principal = await resolver.resolve('docente@colegio.cl');

    expect(principal.features).toEqual([...FEATURE_KEYS]);
  });

  it('usa la org activa persistida (distinta de la default) con sus roles frescos', async () => {
    mockGetActiveMemberships.mockResolvedValue({
      organization: { id: 'org-2', name: 'Colegio Dos', type: 'school' },
      memberships: [{ role: 'school_admin' }],
    });
    const { db } = makeDb({ activeOrgId: 'org-2', orgConfig: {} });
    const resolver = new McpPrincipalResolver(makeAuthService(realUserResult), db);

    const principal = await resolver.resolve('docente@colegio.cl');

    expect(principal.orgId).toBe('org-2');
    expect(principal.orgName).toBe('Colegio Dos');
    expect(principal.roles).toEqual(['school_admin']);
    expect(principal.activeRole).toBe('school_admin');
    expect(mockGetActiveMemberships).toHaveBeenCalledWith(db, 'docente@colegio.cl', 'org-2');
  });

  it('cae a la org por defecto y limpia la fila si la org activa fue revocada', async () => {
    mockGetActiveMemberships.mockResolvedValue(null);
    const { db, deleted } = makeDb({ activeOrgId: 'org-2', orgConfig: {} });
    const resolver = new McpPrincipalResolver(makeAuthService(realUserResult), db);

    const principal = await resolver.resolve('docente@colegio.cl');

    expect(principal.orgId).toBe('org-1');
    expect(principal.roles).toEqual(['teacher', 'eval_coordinator']);
    expect(deleted).toEqual(['cleared']);
  });

  it('no consulta memberships si la org activa persistida es la default', async () => {
    const { db } = makeDb({ activeOrgId: 'org-1', orgConfig: {} });
    const resolver = new McpPrincipalResolver(makeAuthService(realUserResult), db);

    const principal = await resolver.resolve('docente@colegio.cl');

    expect(principal.orgId).toBe('org-1');
    expect(mockGetActiveMemberships).not.toHaveBeenCalled();
  });

  it('rechaza con Forbidden a un usuario pendiente de activación', async () => {
    const { db } = makeDb();
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
      db,
    );

    await expect(resolver.resolve('pendiente@colegio.cl')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('convierte NotFound (email desconocido) en Forbidden', async () => {
    const authService = {
      validateUser: jest.fn().mockRejectedValue(new NotFoundException()),
    } as unknown as AuthService;
    const { db } = makeDb();
    const resolver = new McpPrincipalResolver(authService, db);

    await expect(resolver.resolve('desconocido@otro.cl')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('listMyOrgs marca la org activa y mapea roles', async () => {
    mockListOrgs.mockResolvedValue({
      isPending: false,
      orgs: [
        {
          organization: { id: 'org-1', name: 'Colegio Test' },
          memberships: [{ role: 'teacher' }, { role: 'eval_coordinator' }],
        },
        {
          organization: { id: 'org-2', name: 'Colegio Dos' },
          memberships: [{ role: 'school_admin' }],
        },
      ],
    });
    const { db } = makeDb();
    const resolver = new McpPrincipalResolver(makeAuthService(realUserResult), db);

    const orgs = await resolver.listMyOrgs('docente@colegio.cl', 'org-2');

    expect(orgs).toEqual([
      { orgId: 'org-1', name: 'Colegio Test', roles: ['teacher', 'eval_coordinator'], isActive: false },
      { orgId: 'org-2', name: 'Colegio Dos', roles: ['school_admin'], isActive: true },
    ]);
  });
});
