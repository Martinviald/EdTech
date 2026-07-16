import { Controller, Get, INestApplication, Query, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DATABASE_CONNECTION } from '../../database/database.module';
import { RequireCapability } from '../decorators/capability.decorator';
import { CapabilityGuard } from './capability.guard';

// Ver el comentario del describe: acá interesa el CUERPO HTTP, no la lógica del
// guard (esa está en capability.guard.spec.ts). withOrgContext se sustituye por un
// passthrough para no abrir una transacción real.
jest.mock('@soe/db', () => ({
  ...jest.requireActual<Record<string, unknown>>('@soe/db'),
  withOrgContext: (db: { __tx: unknown }, _orgId: string, fn: (tx: unknown) => unknown) =>
    fn(db.__tx),
}));

@Controller('probe')
@UseGuards(CapabilityGuard)
class ProbeController {
  @Get()
  @RequireCapability('student_matrix')
  get(@Query() _q: unknown) {
    return { ok: true };
  }
}

/**
 * Verifica el CUERPO HTTP del 409, no la lógica del guard.
 *
 * Existe porque el frontend hace `asCapabilityUnavailable(error)` leyendo `code` y
 * `capability` en la RAÍZ del body. Si NestJS envolviera el objeto que le pasamos a
 * `ConflictException` (anidándolo bajo `message`, como hace cuando recibe un string),
 * ese matcher devolvería null y la UI caería al error genérico en vez del estado
 * explicativo — sin que ningún test unitario se enterara. Este acoplamiento entre el
 * guard y la web solo se ve atravesando la capa HTTP de verdad.
 */
describe('CapabilityGuard — contrato HTTP del 409', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const tx = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ dataGranularity: 'aggregate_only' }]),
        }),
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [CapabilityGuard, { provide: DATABASE_CONNECTION, useValue: { __tx: tx } }],
    }).compile();

    app = moduleRef.createNestApplication();
    // Inyecta el user que normalmente pone el guard de auth.
    app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { orgId: 'org-1', isPlatformAdmin: false };
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('devuelve code y capability en la RAÍZ del body, sin envolver', async () => {
    const res = await request(app.getHttpServer()).get(
      '/probe?assessmentId=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    );

    expect(res.status).toBe(409);
    // Estos 3 campos son exactamente lo que lee asCapabilityUnavailable() en la web.
    expect(res.body).toMatchObject({
      error: 'CapabilityUnavailable',
      code: 'REQUIRES_ITEM_LEVEL_DATA',
      capability: 'student_matrix',
    });
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
  });
});
