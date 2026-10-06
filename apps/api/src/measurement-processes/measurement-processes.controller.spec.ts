import { BadRequestException } from '@nestjs/common';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { MeasurementProcessesController } from './measurement-processes.controller';
import type { MeasurementProcessesService } from './measurement-processes.service';

const PROCESS_ID = '6f1c2b0e-8a4d-4c3b-9f2e-1a2b3c4d5e6f';
const user = { userId: 'u-1', orgId: 'org-1', roles: ['school_admin'] } as unknown as JwtPayload;

function makeController() {
  const calls: string[] = [];
  const service = {
    list: async () => calls.push('list'),
    create: async () => calls.push('create'),
    update: async () => calls.push('update'),
    linkAssessments: async () => calls.push('linkAssessments'),
  } as unknown as MeasurementProcessesService;
  return { controller: new MeasurementProcessesController(service), calls };
}

describe('MeasurementProcessesController: entradas inválidas responden 400', () => {
  it('listado con un filtro desconocido', () => {
    const { controller, calls } = makeController();
    expect(() => controller.list({ pageSize: '10' }, user)).toThrow(BadRequestException);
    expect(calls).toEqual([]);
  });

  it('crear sin campos obligatorios', () => {
    const { controller, calls } = makeController();
    expect(() => controller.create({ name: 'DIA' }, user)).toThrow(BadRequestException);
    expect(calls).toEqual([]);
  });

  it('actualizar con una clave desconocida', () => {
    const { controller, calls } = makeController();
    expect(() => controller.update(PROCESS_ID, { slug: 'otro' }, user)).toThrow(
      BadRequestException,
    );
    expect(calls).toEqual([]);
  });

  it('vincular con ids que no son uuid', () => {
    const { controller, calls } = makeController();
    expect(() => controller.linkAssessments(PROCESS_ID, { assessmentIds: ['x'] }, user)).toThrow(
      BadRequestException,
    );
    expect(calls).toEqual([]);
  });

  it('una entrada válida llega al servicio', async () => {
    const { controller, calls } = makeController();
    await controller.update(PROCESS_ID, { name: 'Nuevo nombre' }, user);
    expect(calls).toEqual(['update']);
  });
});
