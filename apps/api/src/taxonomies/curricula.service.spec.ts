import { ForbiddenException } from '@nestjs/common';
import { CurriculaService } from './curricula.service';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { Curriculum } from '@soe/db';

function makeService() {
  // Inyectamos un db mínimo: el service solo lo usa en métodos que aquí no probamos.
  const db = {} as never;
  return new CurriculaService(db);
}

function user(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    userId: 'u1',
    orgId: 'org-1',
    role: 'school_admin',
    email: 'a@b.cl',
    name: 'Test',
    isPlatformAdmin: false,
    ...overrides,
  };
}

function curriculum(overrides: Partial<Curriculum> = {}): Curriculum {
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
  } as Curriculum;
}

describe('CurriculaService.assertVisible', () => {
  const svc = makeService();

  it('permite ver currícula oficiales a cualquier usuario', () => {
    expect(() =>
      svc.assertVisible(curriculum({ isOfficial: true, orgId: null }), user()),
    ).not.toThrow();
  });

  it('permite ver currícula propios de la org', () => {
    expect(() =>
      svc.assertVisible(curriculum({ orgId: 'org-1' }), user({ orgId: 'org-1' })),
    ).not.toThrow();
  });

  it('bloquea currícula custom de otra org', () => {
    expect(() =>
      svc.assertVisible(curriculum({ orgId: 'other' }), user({ orgId: 'org-1' })),
    ).toThrow(ForbiddenException);
  });
});

describe('CurriculaService.assertEditable', () => {
  const svc = makeService();

  it('bloquea oficiales cuando el usuario no es platform_admin', () => {
    expect(() =>
      svc.assertEditable(curriculum({ isOfficial: true }), user({ role: 'school_admin' })),
    ).toThrow(ForbiddenException);
  });

  it('permite editar oficiales a platform_admin', () => {
    expect(() =>
      svc.assertEditable(curriculum({ isOfficial: true }), user({ role: 'platform_admin' })),
    ).not.toThrow();
  });

  it('permite editar custom de la propia org a school_admin', () => {
    expect(() =>
      svc.assertEditable(
        curriculum({ orgId: 'org-1' }),
        user({ orgId: 'org-1', role: 'school_admin' }),
      ),
    ).not.toThrow();
  });

  it('bloquea editar custom de otra org a school_admin', () => {
    expect(() =>
      svc.assertEditable(
        curriculum({ orgId: 'other' }),
        user({ orgId: 'org-1', role: 'school_admin' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('permite a platform_admin editar custom de cualquier org', () => {
    expect(() =>
      svc.assertEditable(
        curriculum({ orgId: 'other' }),
        user({ orgId: 'org-1', role: 'platform_admin' }),
      ),
    ).not.toThrow();
  });
});
