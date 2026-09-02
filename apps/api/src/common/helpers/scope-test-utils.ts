/**
 * Utilidades de test para el alcance docente (`class-group-scope.helper`).
 *
 * El helper consume las queries de dos formas distintas y el mock debe soportar
 * ambas: `select().from().where().limit()` (promesa al final) y
 * `select().from().innerJoin().where()` awaiteado directamente. Por eso la
 * cadena es *thenable*: consume el siguiente lote de la cola tanto en `limit()`
 * como en `await`.
 */
import type { Database } from '@soe/db';
import type { JwtPayload } from '../../auth/jwt-payload.types';
import type { UserRole } from '@soe/types';

export function makeScopedUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  const role: UserRole = overrides.activeRole ?? overrides.role ?? 'teacher';
  return {
    userId: 'user-teacher',
    orgId: 'org-1',
    email: 'profe@x.cl',
    name: 'Profe',
    isPlatformAdmin: role === 'platform_admin',
    roles: [role],
    activeRole: role,
    role,
    ...overrides,
  };
}

export type QueueDbMock = Database & { __remaining: () => number };

/**
 * Mock de Drizzle que devuelve, en orden, cada lote de `results` por cada query
 * ejecutada. Un lote consumido no se repite: si el service hace más queries que
 * lotes provistos, las siguientes devuelven `[]`.
 */
export function makeQueueDb(results: unknown[][]): QueueDbMock {
  let idx = 0;
  const next = (): unknown[] => results[idx++] ?? [];

  const makeChain = (): Record<string, unknown> => {
    let settled: unknown[] | null = null;
    const rows = (): unknown[] => {
      if (settled === null) settled = next();
      return settled;
    };
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      groupBy: () => chain,
      orderBy: () => chain,
      offset: () => chain,
      limit: () => Promise.resolve(rows()),
      then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows()).then(resolve),
    };
    return chain;
  };

  const db = {
    select: () => makeChain(),
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        // `createdAt`/`updatedAt` los pone la DB (default now()); el mock los
        // simula para que los proyectores `toModel` puedan serializarlos.
        returning: () =>
          Promise.resolve([{ id: 'new-id', createdAt: new Date(), updatedAt: new Date(), ...row }]),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve({}) }) }),
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    __remaining: () => results.length - idx,
  } as unknown as QueueDbMock;

  return db;
}
