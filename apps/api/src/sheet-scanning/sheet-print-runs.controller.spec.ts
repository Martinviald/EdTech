import { ForbiddenException } from '@nestjs/common';
import { ZodError } from 'zod';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { SheetPrintRunsController } from './sheet-print-runs.controller';
import type { SheetPrintService } from './sheet-print.service';

const ORG_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ORG_ID = '99999999-9999-4999-8999-999999999999';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const ASSESSMENT_ID = '88888888-8888-4888-8888-888888888888';
const INSTRUMENT_ID = '11111111-1111-4111-8111-111111111111';

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    userId: '33333333-3333-4333-8333-333333333333',
    orgId: ORG_ID,
    email: 'coordinador@colegio.cl',
    name: 'Coordinador',
    isPlatformAdmin: false,
    roles: ['eval_coordinator'],
    activeRole: 'eval_coordinator',
    role: 'eval_coordinator',
    ...overrides,
  };
}

function makeController() {
  const service = {
    updateRun: jest.fn().mockResolvedValue({ id: RUN_ID, assessmentId: ASSESSMENT_ID }),
    listAssessmentOptions: jest.fn().mockResolvedValue([]),
  } as unknown as SheetPrintService;
  return { controller: new SheetPrintRunsController(service), service };
}

describe('SheetPrintRunsController.update', () => {
  it('pasa al service el orgId del token, nunca uno del body', async () => {
    const { controller, service } = makeController();

    await controller.update(
      RUN_ID,
      { assessmentId: ASSESSMENT_ID, orgId: OTHER_ORG_ID },
      makeUser(),
    );

    expect(service.updateRun).toHaveBeenCalledWith(ORG_ID, RUN_ID, {
      assessmentId: ASSESSMENT_ID,
    });
  });

  it('rechaza con 403 un orgId de query distinto al del token', () => {
    const { controller, service } = makeController();

    expect(() =>
      controller.update(RUN_ID, { assessmentId: ASSESSMENT_ID }, makeUser(), OTHER_ORG_ID),
    ).toThrow(ForbiddenException);
    expect(service.updateRun).not.toHaveBeenCalled();
  });

  it('valida el body con Zod: assessmentId es un uuid obligatorio', () => {
    const { controller, service } = makeController();

    expect(() => controller.update(RUN_ID, {}, makeUser())).toThrow(ZodError);
    expect(() => controller.update(RUN_ID, { assessmentId: 'no-es-uuid' }, makeUser())).toThrow(
      ZodError,
    );
    expect(service.updateRun).not.toHaveBeenCalled();
  });
});

describe('SheetPrintRunsController.assessmentOptions', () => {
  it('exige instrumentId y resuelve con el orgId del token', async () => {
    const { controller, service } = makeController();

    await controller.assessmentOptions({ instrumentId: INSTRUMENT_ID }, makeUser());

    expect(service.listAssessmentOptions).toHaveBeenCalledWith(ORG_ID, INSTRUMENT_ID);
  });

  it('rechaza la consulta sin instrumentId', () => {
    const { controller } = makeController();

    expect(() => controller.assessmentOptions({}, makeUser())).toThrow(ZodError);
  });
});
