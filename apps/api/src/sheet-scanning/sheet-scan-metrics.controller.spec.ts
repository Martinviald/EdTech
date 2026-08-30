import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SHEET_MANAGEMENT_ROLES, type SheetScanMetricsResponse } from '@soe/types';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { SheetScanMetricsController } from './sheet-scan-metrics.controller';
import type { SheetScanMetricsService } from './sheet-scan-metrics.service';

const EMPTY_METRICS: SheetScanMetricsResponse = {
  batchesByStatus: {},
  rejectedPagesByReason: {},
  marksByState: {},
  reviewRatePercent: 0,
  firmReadingOverrides: 0,
};

function makeController(): { controller: SheetScanMetricsController; getMetrics: jest.Mock } {
  const getMetrics = jest.fn().mockResolvedValue(EMPTY_METRICS);
  const service = { getMetrics } as unknown as SheetScanMetricsService;
  return { controller: new SheetScanMetricsController(service), getMetrics };
}

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    userId: 'user-1',
    orgId: 'org-1',
    email: 'admin@colegio.cl',
    name: 'Admin',
    isPlatformAdmin: false,
    roles: ['school_admin'],
    activeRole: 'school_admin',
    role: 'school_admin',
    ...overrides,
  };
}

describe('SheetScanMetricsController', () => {
  it('protege GET /sheet-scan-metrics con SHEET_MANAGEMENT_ROLES', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      SheetScanMetricsController.prototype.getMetrics,
    ) as string[];
    expect(roles).toEqual([...SHEET_MANAGEMENT_ROLES]);
  });

  it('consulta las métricas con el orgId del JWT del caller', async () => {
    const { controller, getMetrics } = makeController();

    await expect(controller.getMetrics(makeUser())).resolves.toEqual(EMPTY_METRICS);
    expect(getMetrics).toHaveBeenCalledWith('org-1');
  });

  it('rechaza a un usuario normal que pide métricas de otra org', async () => {
    const { controller, getMetrics } = makeController();

    expect(() => controller.getMetrics(makeUser(), 'org-ajena')).toThrow(ForbiddenException);
    expect(getMetrics).not.toHaveBeenCalled();
  });

  it('exige orgId explícito a un platform_admin', () => {
    const { controller } = makeController();
    const admin = makeUser({ isPlatformAdmin: true, orgId: null });

    expect(() => controller.getMetrics(admin)).toThrow(BadRequestException);
  });
});
