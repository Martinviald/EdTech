import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { parseDtoOrBadRequest } from './parse-dto.helper';

const schema = z.object({
  printRunId: z.string().uuid(),
  imageBase64: z.string().min(1),
});

describe('parseDtoOrBadRequest', () => {
  it('devuelve el DTO parseado cuando el body es válido', () => {
    const body = {
      printRunId: '55555555-5555-4555-8555-555555555555',
      imageBase64: 'Zm90bw==',
    };

    expect(parseDtoOrBadRequest(schema, body)).toEqual(body);
  });

  it('un body inválido lanza 400 con el primer issue y su path, nunca un ZodError crudo', () => {
    let caught: unknown;
    try {
      parseDtoOrBadRequest(schema, { printRunId: 'no-es-uuid', imageBase64: '' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    const message = (caught as BadRequestException).message;
    expect(message).toContain('Solicitud inválida');
    expect(message).toContain('printRunId');
  });

  it('un body que no es objeto lanza 400 con mensaje en español', () => {
    expect(() => parseDtoOrBadRequest(schema, 'texto')).toThrow(BadRequestException);
    expect(() => parseDtoOrBadRequest(schema, 'texto')).toThrow(/Solicitud inválida/);
  });
});
