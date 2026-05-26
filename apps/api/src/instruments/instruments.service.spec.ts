import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InstrumentsService } from './instruments.service';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { Instrument, GradingScale } from '@soe/db';

function makeService() {
  const db = {} as never;
  return new InstrumentsService(db);
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

function instrument(overrides: Partial<Instrument> = {}): Instrument {
  return {
    id: 'inst-1',
    orgId: 'org-1',
    curriculumId: null,
    name: 'DIA Lenguaje 3ro',
    shortName: null,
    type: 'dia',
    subjectId: null,
    gradeId: null,
    year: 2024,
    version: null,
    isOfficial: false,
    status: 'draft',
    gradingScaleId: null,
    config: {},
    createdById: 'u1',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Instrument;
}

function gradingScale(overrides: Partial<GradingScale> = {}): GradingScale {
  return {
    id: 'gs-1',
    orgId: 'org-1',
    name: 'Escala chilena',
    type: 'linear_chilean',
    minGrade: '1.00',
    maxGrade: '7.00',
    passingGrade: '4.00',
    passingThreshold: '0.60',
    config: {},
    createdAt: new Date(),
    ...overrides,
  } as GradingScale;
}

describe('InstrumentsService.assertVisible', () => {
  const svc = makeService();

  it('allows viewing official instruments for any user', () => {
    expect(() =>
      svc.assertVisible(instrument({ isOfficial: true, orgId: null }), user()),
    ).not.toThrow();
  });

  it('allows viewing instruments from own org', () => {
    expect(() =>
      svc.assertVisible(instrument({ orgId: 'org-1' }), user({ orgId: 'org-1' })),
    ).not.toThrow();
  });

  it('blocks instruments from another org', () => {
    expect(() =>
      svc.assertVisible(instrument({ orgId: 'other' }), user({ orgId: 'org-1' })),
    ).toThrow(ForbiddenException);
  });

  it('platform_admin can see anything', () => {
    expect(() =>
      svc.assertVisible(
        instrument({ orgId: 'other' }),
        user({ role: 'platform_admin' }),
      ),
    ).not.toThrow();
  });
});

describe('InstrumentsService.assertEditable', () => {
  const svc = makeService();

  it('blocks official instruments for non-admin', () => {
    expect(() =>
      svc.assertEditable(
        instrument({ isOfficial: true, orgId: null }),
        user({ role: 'school_admin' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows platform_admin to edit official instruments', () => {
    expect(() =>
      svc.assertEditable(
        instrument({ isOfficial: true, orgId: null }),
        user({ role: 'platform_admin' }),
      ),
    ).not.toThrow();
  });

  it('allows editing custom instruments from own org', () => {
    expect(() =>
      svc.assertEditable(
        instrument({ orgId: 'org-1' }),
        user({ orgId: 'org-1', role: 'school_admin' }),
      ),
    ).not.toThrow();
  });

  it('blocks editing instruments from another org', () => {
    expect(() =>
      svc.assertEditable(
        instrument({ orgId: 'other' }),
        user({ orgId: 'org-1', role: 'school_admin' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('platform_admin can edit instruments from any org', () => {
    expect(() =>
      svc.assertEditable(
        instrument({ orgId: 'other' }),
        user({ role: 'platform_admin' }),
      ),
    ).not.toThrow();
  });
});
