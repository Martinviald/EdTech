import { BadRequestException } from '@nestjs/common';
import type { Database } from '@soe/db';
import type { UserRole } from '@soe/types';
import { FeedbackService } from './feedback.service';
import type { FilesService } from '../files/files.service';
import type { StorageService } from '../storage/storage.service';
import type { JwtPayload } from '../auth/jwt-payload.types';

// ──────────────────────────────────────────────────────────────────────────────
// Mock de Database: captura los valores insertados para poder afirmar sobre el
// contenido de la fila. `transaction()` ejecuta el callback con el mismo db
// (withOrgContext lo envuelve), así que el service corre tal cual en producción.
// ──────────────────────────────────────────────────────────────────────────────

type AnyChain = Record<string, (...args: unknown[]) => unknown>;

function makeDb(captured: { values: Record<string, unknown>[] }): Database {
  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        captured.values.push(v);
        return { returning: () => Promise.resolve([{ id: 'fb-1' }]) };
      },
    }),
    select: () => {
      const c: AnyChain = {
        from: () => c,
        leftJoin: () => c,
        where: () => c,
        orderBy: () => c,
        limit: () => c,
        offset: () => c,
        then: (resolve: unknown) => Promise.resolve([]).then(resolve as (v: unknown) => unknown),
      };
      return c;
    },
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
  } as unknown as Database;
  return db;
}

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    userId: 'u1',
    orgId: 'org-1',
    email: 'profe@colegio.cl',
    name: 'Profesora',
    isPlatformAdmin: false,
    roles: ['teacher'] as UserRole[],
    activeRole: 'teacher',
    role: 'teacher',
    ...overrides,
  };
}

const filesStub = {
  createUploadIntent: jest.fn(),
  confirm: jest.fn(),
  getById: jest.fn(),
} as unknown as FilesService;

const storageStub = {
  isConfigured: () => false,
  createDownloadUrl: jest.fn(),
} as unknown as StorageService;

describe('FeedbackService', () => {
  it('toma orgId y autor del token, nunca del body', async () => {
    const captured = { values: [] as Record<string, unknown>[] };
    const service = new FeedbackService(makeDb(captured), filesStub, storageStub);

    await service.create(makeUser(), {
      type: 'bug',
      message: 'La importación se quedó pegada',
      context: { path: '/importar-dia' },
      screenshotFileId: null,
    });

    expect(captured.values[0]).toMatchObject({
      orgId: 'org-1',
      createdById: 'u1',
      type: 'bug',
      message: 'La importación se quedó pegada',
    });
  });

  it('sobrescribe el rol activo que reporte el cliente con el del token', async () => {
    const captured = { values: [] as Record<string, unknown>[] };
    const service = new FeedbackService(makeDb(captured), filesStub, storageStub);

    await service.create(makeUser({ activeRole: 'teacher' }), {
      type: 'idea',
      message: 'Sería útil exportar a Excel',
      // Un cliente manipulado dice ser director; el token manda.
      context: { path: '/dashboard', activeRole: 'school_admin' },
      screenshotFileId: null,
    });

    const context = captured.values[0]?.context as { activeRole?: string; path?: string };
    expect(context.activeRole).toBe('teacher');
    expect(context.path).toBe('/dashboard');
  });

  it('rechaza el envío si el usuario no tiene organización activa', async () => {
    const captured = { values: [] as Record<string, unknown>[] };
    const service = new FeedbackService(makeDb(captured), filesStub, storageStub);

    await expect(
      service.create(makeUser({ orgId: null }), {
        type: 'confusion',
        message: 'No entendí el gráfico',
        context: {},
        screenshotFileId: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(captured.values).toHaveLength(0);
  });
});
