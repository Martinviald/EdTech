import { ForbiddenException } from '@nestjs/common';
import { ItemCollectionsService } from './item-collections.service';
import type { JwtPayload } from '../auth/jwt-payload.types';

function makeService() {
  return new ItemCollectionsService({} as never, {} as never, {} as never);
}

function user(overrides: Partial<JwtPayload> = {}): JwtPayload {
  const role = overrides.activeRole ?? overrides.role ?? 'school_admin';
  return {
    userId: 'u1',
    orgId: 'org-1',
    email: 'a@b.cl',
    name: 'Test',
    roles: [role],
    activeRole: role,
    role,
    isPlatformAdmin: false,
    ...overrides,
  };
}

describe('ItemCollectionsService', () => {
  describe('sin org activa (multi-tenancy)', () => {
    const service = makeService();
    const noOrg = user({ orgId: null });

    it('list rechaza con ForbiddenException', async () => {
      await expect(service.list(noOrg, { page: 1, limit: 50 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('create rechaza con ForbiddenException', async () => {
      await expect(service.create({ name: 'Lista' }, noOrg)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('getById rechaza con ForbiddenException', async () => {
      await expect(service.getById('c1', noOrg)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('addItems rechaza con ForbiddenException', async () => {
      await expect(service.addItems('c1', { itemIds: ['i1'] }, noOrg)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('materialize rechaza con ForbiddenException', async () => {
      await expect(service.materialize('c1', {}, noOrg)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
