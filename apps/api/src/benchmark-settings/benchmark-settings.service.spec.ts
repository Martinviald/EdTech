import { ForbiddenException } from '@nestjs/common';
import type { Database } from '@soe/db';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { UserRole } from '@soe/types';
import { BenchmarkSettingsService } from './benchmark-settings.service';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers de mock
//
// El service ejecuta cadenas Drizzle:
//   db.select().from().where().limit()              → array
//   db.insert(table).values(rows).returning()       → array
//   db.update(table).set(obj).where().returning()   → array
// y abre transacciones vía `withOrgContext` (db.transaction + tx.execute).
//
// `selectResults` agenda las respuestas de cada `select()` en orden. Cada
// insert/update guarda lo que recibe y devuelve la fila configurada en
// `mutationResults` (en orden) para alimentar el `.returning()`.
// ──────────────────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  const role: UserRole = overrides.activeRole ?? overrides.role ?? 'school_admin';
  return {
    userId: 'user-1',
    orgId: 'org-1',
    email: 't@x.cl',
    name: 'Tester',
    isPlatformAdmin: role === 'platform_admin',
    roles: [role],
    activeRole: role,
    role,
    ...overrides,
  };
}

type SelectChain = {
  from: (..._: unknown[]) => SelectChain;
  where: (..._: unknown[]) => SelectChain;
  limit: (..._: unknown[]) => SelectChain;
  then: <T>(resolve: (rows: T[]) => unknown) => Promise<unknown>;
};

type DbMock = Database & {
  __inserts: Array<{ table: unknown; values: unknown }>;
  __updates: Array<{ table: unknown; set: unknown }>;
  __transactionRan: boolean;
};

function makeDb(
  selectResults: unknown[][],
  mutationResults: unknown[][] = [],
): DbMock {
  let selectIdx = 0;
  let mutationIdx = 0;
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; set: unknown }> = [];

  function buildSelect(rows: unknown[]): SelectChain {
    const chain: SelectChain = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      then: (resolve) => Promise.resolve(rows as never).then(resolve as never),
    };
    return chain;
  }

  function nextMutation(): unknown[] {
    const rows = mutationResults[mutationIdx] ?? [];
    mutationIdx++;
    return rows;
  }

  const db = {
    select: () => {
      const rows = selectResults[selectIdx] ?? [];
      selectIdx++;
      return buildSelect(rows);
    },
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return { returning: () => Promise.resolve(nextMutation()) };
      },
    }),
    update: (table: unknown) => ({
      set: (set: unknown) => {
        updates.push({ table, set });
        return {
          where: () => ({ returning: () => Promise.resolve(nextMutation()) }),
        };
      },
    }),
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      db.__transactionRan = true;
      return fn(db);
    },
    __inserts: inserts,
    __updates: updates,
    __transactionRan: false,
  } as unknown as DbMock;

  return db;
}

function makeService(db: Database): BenchmarkSettingsService {
  return new (BenchmarkSettingsService as new (db: Database) => BenchmarkSettingsService)(db);
}

const baseRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'bs-1',
  orgId: 'org-1',
  optOutGlobalPool: false,
  consentGrantedAt: null,
  consentGrantedById: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

// ──────────────────────────────────────────────────────────────────────────────
// getForOrg()
// ──────────────────────────────────────────────────────────────────────────────

describe('BenchmarkSettingsService.getForOrg', () => {
  it('lanza ForbiddenException si el usuario no tiene org activa', async () => {
    const db = makeDb([]);
    const svc = makeService(db);
    await expect(svc.getForOrg(makeUser({ orgId: null }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('devuelve la fila existente sin crear una nueva', async () => {
    const existing = baseRow({ optOutGlobalPool: true });
    const db = makeDb([
      [existing], // select dentro de withOrgContext
      [{ parentId: null }], // deriveNetworkOrgId: org sin parent
    ]);
    const svc = makeService(db);

    const result = await svc.getForOrg(makeUser());

    expect(db.__inserts).toHaveLength(0);
    expect(result.optOutGlobalPool).toBe(true);
    expect(result.orgId).toBe('org-1');
    expect(db.__transactionRan).toBe(true);
  });

  it('crea la fila con defaults (optOut=false) si no existe', async () => {
    const created = baseRow();
    const db = makeDb(
      [
        [], // select → no existe
        [{ parentId: null }], // deriveNetworkOrgId
      ],
      [[created]], // returning del insert
    );
    const svc = makeService(db);

    const result = await svc.getForOrg(makeUser());

    expect(db.__inserts).toHaveLength(1);
    expect((db.__inserts[0].values as { optOutGlobalPool: boolean }).optOutGlobalPool).toBe(
      false,
    );
    expect(result.optOutGlobalPool).toBe(false);
    expect(result.consentGrantedAt).toBeNull();
  });

  it('usa el orgId del token, no del request', async () => {
    const existing = baseRow({ orgId: 'org-from-token' });
    const db = makeDb([[existing], [{ parentId: null }]]);
    const svc = makeService(db);

    const result = await svc.getForOrg(makeUser({ orgId: 'org-from-token' }));

    expect(result.orgId).toBe('org-from-token');
    // El orgId proviene del token, nunca del body.
    expect(db.__transactionRan).toBe(true);
  });

  it('deriva networkOrgId cuando el parent es una foundation', async () => {
    const existing = baseRow();
    const db = makeDb([
      [existing],
      [{ parentId: 'found-1' }], // org tiene parent
      [{ id: 'found-1', type: 'foundation' }], // parent es foundation
    ]);
    const svc = makeService(db);

    const result = await svc.getForOrg(makeUser());

    expect(result.networkOrgId).toBe('found-1');
  });

  it('networkOrgId es null cuando el parent NO es foundation', async () => {
    const existing = baseRow();
    const db = makeDb([
      [existing],
      [{ parentId: 'school-2' }], // tiene parent
      [{ id: 'school-2', type: 'school' }], // parent NO es foundation
    ]);
    const svc = makeService(db);

    const result = await svc.getForOrg(makeUser());

    expect(result.networkOrgId).toBeNull();
  });

  it('networkOrgId es null cuando la org no tiene parent', async () => {
    const existing = baseRow();
    const db = makeDb([[existing], [{ parentId: null }]]);
    const svc = makeService(db);

    const result = await svc.getForOrg(makeUser());

    expect(result.networkOrgId).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// update()
// ──────────────────────────────────────────────────────────────────────────────

describe('BenchmarkSettingsService.update', () => {
  it('lanza ForbiddenException si el usuario no tiene org activa', async () => {
    const db = makeDb([]);
    const svc = makeService(db);
    await expect(
      svc.update(makeUser({ orgId: null }), { optOutGlobalPool: true }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('setea optOut y sella el consentimiento si aún no existe', async () => {
    const existing = baseRow({ optOutGlobalPool: false, consentGrantedAt: null });
    const updated = baseRow({
      optOutGlobalPool: true,
      consentGrantedAt: new Date('2026-06-12T00:00:00Z'),
      consentGrantedById: 'user-1',
    });
    const db = makeDb(
      [
        [existing], // select dentro de withOrgContext
        [{ parentId: null }], // deriveNetworkOrgId
      ],
      [[updated]], // returning del update
    );
    const svc = makeService(db);

    const result = await svc.update(makeUser(), { optOutGlobalPool: true });

    expect(db.__updates).toHaveLength(1);
    const setArg = db.__updates[0].set as {
      optOutGlobalPool: boolean;
      consentGrantedAt?: Date;
      consentGrantedById?: string;
    };
    expect(setArg.optOutGlobalPool).toBe(true);
    expect(setArg.consentGrantedAt).toBeInstanceOf(Date);
    expect(setArg.consentGrantedById).toBe('user-1');
    expect(result.optOutGlobalPool).toBe(true);
    expect(result.consentGrantedAt).not.toBeNull();
  });

  it('NO sobrescribe el consentimiento si ya estaba sellado', async () => {
    const sealedAt = new Date('2026-01-01T00:00:00Z');
    const existing = baseRow({
      consentGrantedAt: sealedAt,
      consentGrantedById: 'someone-else',
    });
    const updated = baseRow({
      optOutGlobalPool: true,
      consentGrantedAt: sealedAt,
      consentGrantedById: 'someone-else',
    });
    const db = makeDb([[existing], [{ parentId: null }]], [[updated]]);
    const svc = makeService(db);

    await svc.update(makeUser(), { optOutGlobalPool: true });

    const setArg = db.__updates[0].set as {
      consentGrantedAt?: Date;
      consentGrantedById?: string;
    };
    // No re-sella → estas claves no se incluyen en el set.
    expect(setArg.consentGrantedAt).toBeUndefined();
    expect(setArg.consentGrantedById).toBeUndefined();
  });

  it('crea la fila con consentimiento sellado si no existe', async () => {
    const created = baseRow({
      optOutGlobalPool: true,
      consentGrantedAt: new Date('2026-06-12T00:00:00Z'),
      consentGrantedById: 'user-1',
    });
    const db = makeDb(
      [
        [], // no existe
        [{ parentId: null }],
      ],
      [[created]], // returning del insert
    );
    const svc = makeService(db);

    const result = await svc.update(makeUser(), { optOutGlobalPool: true });

    expect(db.__inserts).toHaveLength(1);
    const values = db.__inserts[0].values as {
      consentGrantedAt?: Date;
      consentGrantedById?: string;
    };
    expect(values.consentGrantedAt).toBeInstanceOf(Date);
    expect(values.consentGrantedById).toBe('user-1');
    expect(result.optOutGlobalPool).toBe(true);
  });

  it('corre dentro de withOrgContext (transacción)', async () => {
    const existing = baseRow();
    const updated = baseRow({ optOutGlobalPool: true });
    const db = makeDb([[existing], [{ parentId: null }]], [[updated]]);
    const svc = makeService(db);

    await svc.update(makeUser(), { optOutGlobalPool: true });

    expect(db.__transactionRan).toBe(true);
  });
});
