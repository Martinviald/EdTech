import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { FeatureKey } from '@soe/types';
import { FeatureGuard } from './feature.guard';
import type { JwtPayload } from '../../auth/jwt-payload.types';

type OrgRow = { config: Record<string, unknown> } | undefined;

/** Mock mínimo del cliente Drizzle: select().from().where() → Promise<rows>. */
function mockDb(row: OrgRow) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(row ? [row] : []),
      }),
    }),
  } as never;
}

function mockContext(user: Partial<JwtPayload>): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

function makeReflector(feature: FeatureKey | undefined): Reflector {
  return { getAllAndOverride: () => feature } as unknown as Reflector;
}

const baseUser: JwtPayload = {
  userId: 'u1',
  orgId: 'org-1',
  email: 'a@b.cl',
  name: 'Test',
  isPlatformAdmin: false,
  roles: ['teacher'],
  activeRole: 'teacher',
  role: 'teacher',
};

describe('FeatureGuard', () => {
  it('permite si la ruta no declara feature (no es ruta gateada)', async () => {
    const guard = new FeatureGuard(makeReflector(undefined), mockDb({ config: {} }));
    await expect(guard.canActivate(mockContext(baseUser))).resolves.toBe(true);
  });

  it('exime a platform_admin sin tocar la DB', async () => {
    const guard = new FeatureGuard(makeReflector('ai_analysis'), mockDb(undefined));
    const ctx = mockContext({ ...baseUser, isPlatformAdmin: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rechaza a un usuario sin orgId (y no admin)', async () => {
    const guard = new FeatureGuard(makeReflector('remedial'), mockDb(undefined));
    const ctx = mockContext({ ...baseUser, orgId: null });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('permite por default cuando la org no tiene allowedFeatures configurado', async () => {
    const guard = new FeatureGuard(makeReflector('benchmarking'), mockDb({ config: {} }));
    await expect(guard.canActivate(mockContext(baseUser))).resolves.toBe(true);
  });

  it('permite cuando la feature está en allowedFeatures', async () => {
    const guard = new FeatureGuard(
      makeReflector('ai_analysis'),
      mockDb({ config: { allowedFeatures: ['ai_analysis'] } }),
    );
    await expect(guard.canActivate(mockContext(baseUser))).resolves.toBe(true);
  });

  it('rechaza cuando la feature NO está en allowedFeatures', async () => {
    const guard = new FeatureGuard(
      makeReflector('benchmarking'),
      mockDb({ config: { allowedFeatures: ['ai_analysis'] } }),
    );
    await expect(guard.canActivate(mockContext(baseUser))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rechaza cuando allowedFeatures está vacío (plan sin features pagas)', async () => {
    const guard = new FeatureGuard(
      makeReflector('ai_analysis'),
      mockDb({ config: { allowedFeatures: [] } }),
    );
    await expect(guard.canActivate(mockContext(baseUser))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('permite si la org no existe pero la política default habilita (config nulo)', async () => {
    // Sin fila → org?.config = undefined → isFeatureAllowed default true.
    const guard = new FeatureGuard(makeReflector('remedial'), mockDb(undefined));
    await expect(guard.canActivate(mockContext(baseUser))).resolves.toBe(true);
  });
});
