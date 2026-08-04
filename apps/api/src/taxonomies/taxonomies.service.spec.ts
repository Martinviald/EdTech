import { ForbiddenException } from '@nestjs/common';
import { TaxonomiesService } from './taxonomies.service';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { Taxonomy } from '@soe/db';

function makeService() {
  // Inyectamos un db mínimo: el service solo lo usa en métodos que aquí no probamos.
  const db = {} as never;
  return new TaxonomiesService(db);
}

function user(overrides: Partial<JwtPayload> = {}): JwtPayload {
  const role = overrides.activeRole ?? overrides.role ?? 'school_admin';
  // Si el fixture pide platform_admin sin setear isPlatformAdmin explícito,
  // derivamos el flag — coherente con el invariante del AuthGuard.
  const isPlatformAdmin =
    overrides.isPlatformAdmin ?? (role === 'platform_admin');
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

function taxonomy(overrides: Partial<Taxonomy> = {}): Taxonomy {
  return {
    id: 'c1',
    name: 'Test',
    type: 'custom',
    language: 'es',
    version: null,
    isOfficial: false,
    orgId: 'org-1',
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  } as Taxonomy;
}

describe('TaxonomiesService.assertVisible', () => {
  const svc = makeService();

  it('permite ver currícula oficiales a cualquier usuario', () => {
    expect(() =>
      svc.assertVisible(taxonomy({ isOfficial: true, orgId: null }), user()),
    ).not.toThrow();
  });

  it('permite ver currícula propios de la org', () => {
    expect(() =>
      svc.assertVisible(taxonomy({ orgId: 'org-1' }), user({ orgId: 'org-1' })),
    ).not.toThrow();
  });

  it('bloquea currícula custom de otra org', () => {
    expect(() =>
      svc.assertVisible(taxonomy({ orgId: 'other' }), user({ orgId: 'org-1' })),
    ).toThrow(ForbiddenException);
  });
});

describe('TaxonomiesService.assertEditable', () => {
  const svc = makeService();

  it('bloquea oficiales cuando el usuario no es platform_admin', () => {
    expect(() =>
      svc.assertEditable(taxonomy({ isOfficial: true }), user({ role: 'school_admin' })),
    ).toThrow(ForbiddenException);
  });

  it('permite editar oficiales a platform_admin', () => {
    expect(() =>
      svc.assertEditable(taxonomy({ isOfficial: true }), user({ role: 'platform_admin' })),
    ).not.toThrow();
  });

  it('permite editar custom de la propia org a school_admin', () => {
    expect(() =>
      svc.assertEditable(
        taxonomy({ orgId: 'org-1' }),
        user({ orgId: 'org-1', role: 'school_admin' }),
      ),
    ).not.toThrow();
  });

  it('bloquea editar custom de otra org a school_admin', () => {
    expect(() =>
      svc.assertEditable(
        taxonomy({ orgId: 'other' }),
        user({ orgId: 'org-1', role: 'school_admin' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('permite a platform_admin editar custom de cualquier org', () => {
    expect(() =>
      svc.assertEditable(
        taxonomy({ orgId: 'other' }),
        user({ orgId: 'org-1', role: 'platform_admin' }),
      ),
    ).not.toThrow();
  });
});
