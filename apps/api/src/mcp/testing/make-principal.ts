import type { AnalyticsPrincipal } from '../core/analytics-principal';

export function makePrincipal(
  overrides: Partial<AnalyticsPrincipal> = {},
): AnalyticsPrincipal {
  return {
    userId: 'user-1',
    orgId: 'org-1',
    orgName: 'Colegio Test',
    orgs: [{ id: 'org-1', name: 'Colegio Test' }],
    email: 'docente@colegio.cl',
    name: 'Usuario Test',
    isPlatformAdmin: false,
    roles: ['teacher'],
    activeRole: 'teacher',
    role: 'teacher',
    features: [],
    channel: 'in-app',
    ...overrides,
  };
}
