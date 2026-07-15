import { ConflictException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { AnalyticsCapability, DataGranularity } from '@soe/types';
import { CapabilityGuard } from './capability.guard';
import type { JwtPayload } from '../../auth/jwt-payload.types';

// `withOrgContext` abre una transacción real contra Postgres. Acá solo interesa que
// el guard lea la granularidad, así que se sustituye por un passthrough que entrega
// el mock de `tx`.
jest.mock('@soe/db', () => ({
  ...jest.requireActual<Record<string, unknown>>('@soe/db'),
  withOrgContext: (db: { __tx: unknown }, _orgId: string, fn: (tx: unknown) => unknown) =>
    fn(db.__tx),
}));

type Row = { dataGranularity: DataGranularity } | undefined;

/** Mock mínimo: select().from().where() → Promise<rows>, expuesto como `tx`. */
function mockDb(row: Row) {
  const tx = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(row ? [row] : []),
      }),
    }),
  };
  return { __tx: tx } as never;
}

function mockContext(
  user: Partial<JwtPayload>,
  params: Record<string, string> = {},
  query: Record<string, unknown> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, params, query }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as never;
}

function guardFor(capability: AnalyticsCapability | undefined, row: Row) {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(capability);
  return new CapabilityGuard(reflector, mockDb(row));
}

const USER: Partial<JwtPayload> = { orgId: 'org-1', isPlatformAdmin: false };
const UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('CapabilityGuard', () => {
  it('deja pasar cuando la ruta no declara capacidad', async () => {
    const guard = guardFor(undefined, undefined);
    await expect(guard.canActivate(mockContext(USER))).resolves.toBe(true);
  });

  it('deja pasar una capacidad que la granularidad soporta', async () => {
    const guard = guardFor('student_matrix', { dataGranularity: 'item_level' });
    await expect(guard.canActivate(mockContext(USER, { assessmentId: UUID }))).resolves.toBe(true);
  });

  it('rechaza con 409 y código legible por máquina si la granularidad no la soporta', async () => {
    const guard = guardFor('student_matrix', { dataGranularity: 'aggregate_only' });
    const ctx = mockContext(USER, { assessmentId: UUID });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ConflictException);
    await guard.canActivate(ctx).catch((e: ConflictException) => {
      expect(e.getResponse()).toMatchObject({
        statusCode: 409,
        error: 'CapabilityUnavailable',
        code: 'REQUIRES_ITEM_LEVEL_DATA',
        capability: 'student_matrix',
      });
    });
  });

  it('permite las capacidades agregables en aggregate_only', async () => {
    const guard = guardFor('cohort_item_stats', { dataGranularity: 'aggregate_only' });
    await expect(guard.canActivate(mockContext(USER, { assessmentId: UUID }))).resolves.toBe(true);
  });

  it('NO exime al platform_admin: es disponibilidad de dato, no permiso', async () => {
    const guard = guardFor('psychometrics', { dataGranularity: 'aggregate_only' });
    const ctx = mockContext({ orgId: 'org-1', isPlatformAdmin: true }, { assessmentId: UUID });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ConflictException);
  });

  it('resuelve el assessmentId desde el query, no solo del path', async () => {
    const guard = guardFor('student_matrix', { dataGranularity: 'aggregate_only' });
    await expect(guard.canActivate(mockContext(USER, {}, { assessmentId: UUID }))).rejects.toThrow(
      ConflictException,
    );
  });

  it('deja pasar sin assessmentId: la ruta agrega across assessments', async () => {
    const guard = guardFor('student_matrix', { dataGranularity: 'aggregate_only' });
    await expect(guard.canActivate(mockContext(USER))).resolves.toBe(true);
  });

  it('deja pasar si el assessment no existe: el 404 lo da el service, no el guard', async () => {
    const guard = guardFor('student_matrix', undefined);
    await expect(guard.canActivate(mockContext(USER, { assessmentId: UUID }))).resolves.toBe(true);
  });

  it('ignora un assessmentId mal formado en vez de mandarlo a Postgres', async () => {
    // Los guards corren antes de los pipes: acá el id todavía no pasó por Zod. Sin
    // chequeo de forma, 'abc' llegaría como comparación de uuid → 22P02 → 500, en vez
    // del 400 que devuelve el schema del handler.
    const guard = guardFor('student_matrix', { dataGranularity: 'aggregate_only' });
    await expect(guard.canActivate(mockContext(USER, { assessmentId: 'abc' }))).resolves.toBe(true);
  });
});
