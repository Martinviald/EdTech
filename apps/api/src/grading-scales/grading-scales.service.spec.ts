import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { GradingScale } from '@soe/db';
import { GradingScalesService } from './grading-scales.service';
import type { JwtPayload } from '../auth/jwt-payload.types';

// ──────────────────────────── helpers de mocks ────────────────────────────
//
// Drizzle expone un builder chainable (`db.select().from(table).where(...)`)
// que termina ejecutándose al hacer await. Aquí construimos un stub
// reusable que captura las llamadas y devuelve un array configurado por
// test, sin tocar Postgres ni `drizzle-orm` real.

function buildDbMock(config: {
  selectResults?: unknown[][];
  insertReturning?: unknown[];
  updateReturning?: unknown[];
  deleteCalls?: { count: number };
}) {
  const selectQueue: unknown[][] = [...(config.selectResults ?? [])];

  const select = jest.fn(() => {
    const queryBuilder: Record<string, unknown> = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) => {
        const next = selectQueue.shift() ?? [];
        return Promise.resolve(next).then(resolve);
      },
    };
    return queryBuilder;
  });

  const insert = jest.fn(() => ({
    values: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue(config.insertReturning ?? []),
  }));

  const update = jest.fn(() => ({
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue(config.updateReturning ?? []),
  }));

  const del = jest.fn(() => {
    if (config.deleteCalls) config.deleteCalls.count += 1;
    return {
      where: jest.fn().mockResolvedValue(undefined),
    };
  });

  return {
    select,
    insert,
    update,
    delete: del,
  } as unknown as ConstructorParameters<typeof GradingScalesService>[0];
}

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  const role = overrides.activeRole ?? overrides.role ?? 'school_admin';
  const isPlatformAdmin = overrides.isPlatformAdmin ?? role === 'platform_admin';
  return {
    userId: 'user-1',
    orgId: 'org-1',
    email: 'a@b.cl',
    name: 'Test',
    roles: [role],
    activeRole: role,
    role,
    ...overrides,
    isPlatformAdmin,
  };
}

function makeScale(overrides: Partial<GradingScale> = {}): GradingScale {
  return {
    id: 'scale-1',
    orgId: 'org-1',
    name: 'Escala chilena 60%',
    type: 'linear_chilean',
    minGrade: '1.00',
    maxGrade: '7.00',
    passingGrade: '4.00',
    passingThreshold: '0.60',
    config: {},
    createdAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  } as GradingScale;
}

// ─────────────────────────────── tests ────────────────────────────────

describe('GradingScalesService.list', () => {
  it('retorna globales + escalas de la org del usuario con paginación', async () => {
    const global = makeScale({ id: 'global-1', orgId: null, name: 'Global' });
    const own = makeScale({ id: 'own-1', orgId: 'org-1', name: 'Propia' });
    const db = buildDbMock({
      // 1ra select: count → [{ count: 2 }]. 2da select: rows → [global, own].
      selectResults: [[{ count: 2 }], [global, own]],
    });
    const svc = new GradingScalesService(db);

    const result = await svc.list(makeUser(), { page: 1, limit: 20 });

    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]!.isGlobal).toBe(true);
    expect(result.data[1]!.isGlobal).toBe(false);
  });

  it('filtra por type e isGlobal cuando se piden en el query', async () => {
    const global = makeScale({ id: 'g', orgId: null, type: 'percentage' });
    const db = buildDbMock({ selectResults: [[{ count: 1 }], [global]] });
    const svc = new GradingScalesService(db);

    const result = await svc.list(makeUser(), {
      page: 1,
      limit: 10,
      type: 'percentage',
      isGlobal: true,
    });

    expect(result.total).toBe(1);
    expect(result.data[0]!.type).toBe('percentage');
    expect(result.data[0]!.isGlobal).toBe(true);
  });
});

describe('GradingScalesService.getById', () => {
  it('retorna la escala cuando existe y es visible', async () => {
    const scale = makeScale();
    const db = buildDbMock({ selectResults: [[scale]] });
    const svc = new GradingScalesService(db);

    const result = await svc.getById(makeUser(), 'scale-1');
    expect(result.id).toBe('scale-1');
    // El Model contract preserva los decimales de Drizzle como string.
    expect(result.minGrade).toBe('1.00');
    expect(result.maxGrade).toBe('7.00');
  });

  it('lanza NotFoundException si la escala pertenece a otra org', async () => {
    // El filtro multi-tenancy hace que la query no devuelva nada.
    const db = buildDbMock({ selectResults: [[]] });
    const svc = new GradingScalesService(db);

    await expect(svc.getById(makeUser({ orgId: 'org-1' }), 'other-org-scale')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('GradingScalesService.create', () => {
  it('rechaza si minGrade >= passingGrade', async () => {
    const db = buildDbMock({});
    const svc = new GradingScalesService(db);

    await expect(
      svc.create(makeUser(), {
        name: 'Mala',
        type: 'linear_chilean',
        minGrade: 5,
        maxGrade: 7,
        passingGrade: 4,
        passingThreshold: 0.6,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('inserta usando user.orgId (nunca del body) y retorna isGlobal=false', async () => {
    const created = makeScale({ id: 'new-1', orgId: 'org-1', name: 'Nueva' });
    const db = buildDbMock({ insertReturning: [created] });
    const svc = new GradingScalesService(db);

    const result = await svc.create(makeUser({ orgId: 'org-1' }), {
      name: 'Nueva',
      type: 'linear_chilean',
      minGrade: 1,
      maxGrade: 7,
      passingGrade: 4,
      passingThreshold: 0.6,
    });

    expect(result.id).toBe('new-1');
    expect(result.orgId).toBe('org-1');
    expect(result.isGlobal).toBe(false);
  });
});

describe('GradingScalesService.update', () => {
  it('rechaza editar una escala global cuando el usuario no es platform_admin', async () => {
    const globalScale = makeScale({ orgId: null });
    const db = buildDbMock({ selectResults: [[globalScale]] });
    const svc = new GradingScalesService(db);

    await expect(
      svc.update(makeUser({ role: 'school_admin' }), 'scale-1', { name: 'Nuevo nombre' }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('GradingScalesService.delete', () => {
  it('lanza ConflictException si hay instrumentos referenciando la escala', async () => {
    const ownScale = makeScale({ orgId: 'org-1' });
    const db = buildDbMock({
      // 1ra select: findVisibleById → [ownScale]. 2da select: count de
      // instrumentos → [{ count: 3 }].
      selectResults: [[ownScale], [{ count: 3 }]],
    });
    const svc = new GradingScalesService(db);

    await expect(svc.delete(makeUser({ orgId: 'org-1' }), 'scale-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('ejecuta el delete cuando no hay instrumentos vinculados', async () => {
    const ownScale = makeScale({ orgId: 'org-1' });
    const deleteCalls = { count: 0 };
    const db = buildDbMock({
      selectResults: [[ownScale], [{ count: 0 }]],
      deleteCalls,
    });
    const svc = new GradingScalesService(db);

    await svc.delete(makeUser({ orgId: 'org-1' }), 'scale-1');
    expect(deleteCalls.count).toBe(1);
  });
});

describe('GradingScalesService.previewConversion', () => {
  it('convierte porcentajes a notas usando la escala (60% → 4.0)', async () => {
    const scale = makeScale();
    const db = buildDbMock({ selectResults: [[scale]] });
    const svc = new GradingScalesService(db);

    const result = await svc.previewConversion(makeUser(), 'scale-1', [0, 0.3, 0.6, 0.8, 1]);

    expect(result.scaleId).toBe('scale-1');
    expect(result.rows).toHaveLength(5);

    expect(result.rows[0]!.percentage).toBe(0);
    expect(result.rows[0]!.grade).toBe(1.0);
    expect(result.rows[0]!.isPassing).toBe(false);

    // 30% sobre el tramo 0..60 con notas 1..4 → 2.5
    expect(result.rows[1]!.grade).toBe(2.5);
    expect(result.rows[1]!.isPassing).toBe(false);

    // 60% exigencia → 4.0 (punto de quiebre)
    expect(result.rows[2]!.grade).toBe(4.0);
    expect(result.rows[2]!.isPassing).toBe(true);

    // 80% → mitad del tramo alto (4..7) → 5.5
    expect(result.rows[3]!.grade).toBe(5.5);
    expect(result.rows[3]!.isPassing).toBe(true);

    expect(result.rows[4]!.grade).toBe(7.0);
    expect(result.rows[4]!.isPassing).toBe(true);
  });
});
