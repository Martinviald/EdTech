import { ForbiddenException } from '@nestjs/common';
import { ItemsService } from './items.service';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { Item } from '@soe/db';

function makeService() {
  const db = {} as never;
  return new ItemsService(db);
}

function user(overrides: Partial<JwtPayload> = {}): JwtPayload {
  const role = overrides.activeRole ?? overrides.role ?? 'school_admin';
  const isPlatformAdmin = overrides.isPlatformAdmin ?? (role === 'platform_admin');
  return {
    userId: 'u1',
    orgId: 'org-1',
    email: 'a@b.cl',
    name: 'Test',
    roles: [role],
    activeRole: role,
    role,
    ...overrides,
    isPlatformAdmin,
  };
}

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    orgId: 'org-1',
    instrumentId: null,
    sectionId: null,
    position: 0,
    type: 'multiple_choice',
    content: {},
    scoringConfig: { points: 1 },
    irtParams: {},
    status: 'draft',
    version: 1,
    source: 'custom',
    createdById: 'u1',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Item;
}

describe('ItemsService.assertVisible', () => {
  const svc = makeService();

  it('allows viewing official items (null orgId) for any user', () => {
    expect(() =>
      svc.assertVisible(item({ orgId: null }), user()),
    ).not.toThrow();
  });

  it('allows viewing items from own org', () => {
    expect(() =>
      svc.assertVisible(item({ orgId: 'org-1' }), user({ orgId: 'org-1' })),
    ).not.toThrow();
  });

  it('blocks items from another org', () => {
    expect(() =>
      svc.assertVisible(item({ orgId: 'other' }), user({ orgId: 'org-1' })),
    ).toThrow(ForbiddenException);
  });

  it('platform_admin can see anything', () => {
    expect(() =>
      svc.assertVisible(
        item({ orgId: 'other' }),
        user({ role: 'platform_admin' }),
      ),
    ).not.toThrow();
  });
});

describe('ItemsService.assertEditable', () => {
  const svc = makeService();

  it('blocks official items (null orgId) for non-admin', () => {
    expect(() =>
      svc.assertEditable(item({ orgId: null }), user({ role: 'school_admin' })),
    ).toThrow(ForbiddenException);
  });

  it('allows platform_admin to edit official items', () => {
    expect(() =>
      svc.assertEditable(item({ orgId: null }), user({ role: 'platform_admin' })),
    ).not.toThrow();
  });

  it('allows editing items from own org', () => {
    expect(() =>
      svc.assertEditable(
        item({ orgId: 'org-1' }),
        user({ orgId: 'org-1', role: 'school_admin' }),
      ),
    ).not.toThrow();
  });

  it('blocks editing items from another org', () => {
    expect(() =>
      svc.assertEditable(
        item({ orgId: 'other' }),
        user({ orgId: 'org-1', role: 'school_admin' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('platform_admin can edit items from any org', () => {
    expect(() =>
      svc.assertEditable(
        item({ orgId: 'other' }),
        user({ role: 'platform_admin' }),
      ),
    ).not.toThrow();
  });
});
