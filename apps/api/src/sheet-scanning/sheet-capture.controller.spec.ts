import { BadRequestException } from '@nestjs/common';
import type { CaptureSessionService } from './capture-session.service';
import type { ActiveCaptureSession } from './capture-token.helpers';
import { SheetCaptureController } from './sheet-capture.controller';

const SESSION: ActiveCaptureSession = {
  sessionId: '44444444-4444-4444-8444-444444444444',
  orgId: '22222222-2222-4222-8222-222222222222',
  printRunId: '66666666-6666-4666-8666-666666666666',
  batchId: '55555555-5555-4555-8555-555555555555',
};

function makeController() {
  const service = {
    redeem: jest.fn().mockResolvedValue({ token: 't' }),
    getStatus: jest.fn().mockResolvedValue({ id: SESSION.sessionId }),
    assess: jest.fn().mockResolvedValue({ accepted: true }),
    createUploadIntent: jest.fn().mockResolvedValue({ fileId: 'f' }),
    confirmFile: jest.fn().mockResolvedValue(undefined),
    finish: jest.fn().mockResolvedValue({ batchId: SESSION.batchId, batchStatus: 'processing' }),
  } as unknown as CaptureSessionService;
  return { controller: new SheetCaptureController(service), service };
}

describe('SheetCaptureController', () => {
  it('redeem valida el body y delega el DTO parseado', async () => {
    const { controller, service } = makeController();
    const secret = 'a'.repeat(43);

    await controller.redeem({ sessionId: SESSION.sessionId, secret });

    expect(service.redeem).toHaveBeenCalledWith({ sessionId: SESSION.sessionId, secret });
  });

  it('redeem rechaza con 400 un body inválido sin llegar al service', () => {
    const { controller, service } = makeController();

    expect(() => controller.redeem({ sessionId: SESSION.sessionId, secret: 'corto' })).toThrow(
      BadRequestException,
    );
    expect(service.redeem).not.toHaveBeenCalled();
  });

  it('assess descarta cualquier printRunId del body: sólo pasa la imagen', async () => {
    const { controller, service } = makeController();

    await controller.assess(SESSION, { imageBase64: 'img', printRunId: 'ajeno' });

    expect(service.assess).toHaveBeenCalledWith(SESSION, { imageBase64: 'img' });
  });

  it('getSession consulta el estado con el orgId y sessionId del token', async () => {
    const { controller, service } = makeController();

    await controller.getSession(SESSION);

    expect(service.getStatus).toHaveBeenCalledWith(SESSION.orgId, SESSION.sessionId);
  });

  it('confirmFile delega con el fileId de la ruta', async () => {
    const { controller, service } = makeController();

    await controller.confirmFile(SESSION, 'file-1', { sizeBytes: 1024 });

    expect(service.confirmFile).toHaveBeenCalledWith(SESSION, 'file-1', { sizeBytes: 1024 });
  });

  it('finish cierra la sesión del token sin userId', async () => {
    const { controller, service } = makeController();

    await controller.finish(SESSION);

    expect(service.finish).toHaveBeenCalledWith(SESSION.orgId, SESSION.sessionId, null);
  });
});
