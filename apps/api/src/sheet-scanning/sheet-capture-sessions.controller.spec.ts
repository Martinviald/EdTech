import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { CaptureSessionService } from './capture-session.service';
import { SheetCaptureSessionsController } from './sheet-capture-sessions.controller';

const ORG_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ORG_ID = '99999999-9999-4999-8999-999999999999';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    userId: USER_ID,
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
    create: jest.fn().mockResolvedValue({ sessionId: SESSION_ID }),
    getStatus: jest.fn().mockResolvedValue({ id: SESSION_ID }),
    revoke: jest.fn().mockResolvedValue({ id: SESSION_ID, status: 'revoked' }),
    finish: jest.fn().mockResolvedValue({ batchId: 'b', batchStatus: 'processing' }),
  } as unknown as CaptureSessionService;
  return { controller: new SheetCaptureSessionsController(service), service };
}

describe('SheetCaptureSessionsController', () => {
  it('create usa el orgId del token y el userId del caller', async () => {
    const { controller, service } = makeController();

    await controller.create({ printRunId: RUN_ID }, makeUser());

    expect(service.create).toHaveBeenCalledWith(ORG_ID, USER_ID, { printRunId: RUN_ID });
  });

  it('create rechaza con 403 un orgId de query ajeno', () => {
    const { controller, service } = makeController();

    expect(() => controller.create({ printRunId: RUN_ID }, makeUser(), OTHER_ORG_ID)).toThrow(
      ForbiddenException,
    );
    expect(service.create).not.toHaveBeenCalled();
  });

  it('create rechaza con 400 un printRunId que no es uuid', () => {
    const { controller, service } = makeController();

    expect(() => controller.create({ printRunId: 'no-uuid' }, makeUser())).toThrow(
      BadRequestException,
    );
    expect(service.create).not.toHaveBeenCalled();
  });

  it('revoke delega con el orgId del token', async () => {
    const { controller, service } = makeController();

    await controller.revoke(SESSION_ID, makeUser());

    expect(service.revoke).toHaveBeenCalledWith(ORG_ID, SESSION_ID);
  });

  it('finish desde el PC pasa el userId del caller', async () => {
    const { controller, service } = makeController();

    await controller.finish(SESSION_ID, makeUser());

    expect(service.finish).toHaveBeenCalledWith(ORG_ID, SESSION_ID, USER_ID);
  });
});
