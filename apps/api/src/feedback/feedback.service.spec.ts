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

function makeDb(
  captured: { values: Record<string, unknown>[] },
  selectResults: unknown[][] = [],
): Database {
  let selectIdx = 0;
  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        captured.values.push(v);
        return { returning: () => Promise.resolve([{ id: 'fb-1' }]) };
      },
    }),
    select: () => {
      const rows = selectResults[selectIdx] ?? [];
      selectIdx++;
      const c: AnyChain = {
        from: () => c,
        leftJoin: () => c,
        where: () => c,
        orderBy: () => c,
        limit: () => c,
        offset: () => c,
        then: (resolve: unknown) => Promise.resolve(rows).then(resolve as (v: unknown) => unknown),
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

function feedbackRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fb-1',
    type: 'bug' as const,
    status: 'new' as const,
    message: 'Mensaje',
    context: {},
    internalNote: null,
    screenshotFileId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    createdByName: 'Profesora',
    ...overrides,
  };
}

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

  it('une los comentarios de todas las orgs, ordena por fecha y pagina sobre el conjunto', async () => {
    const captured = { values: [] as Record<string, unknown>[] };
    // 1) las orgs; 2) filas de org-1; 3) filas de org-2.
    const service = new FeedbackService(
      makeDb(captured, [
        [
          { id: 'org-1', name: 'Colegio Uno' },
          { id: 'org-2', name: 'Colegio Dos' },
        ],
        [feedbackRow({ id: 'a', createdAt: new Date('2026-01-01T00:00:00Z') })],
        [
          feedbackRow({ id: 'b', createdAt: new Date('2026-03-01T00:00:00Z') }),
          feedbackRow({ id: 'c', createdAt: new Date('2026-02-01T00:00:00Z') }),
        ],
      ]),
      filesStub,
      storageStub,
    );

    const page1 = await service.listAllOrgs({ page: 1, limit: 2 });

    // El más nuevo es de la SEGUNDA org: si se paginara por org, 'b' no saldría
    // primero y las páginas quedarían incoherentes al mezclarlas.
    expect(page1.data.map((f) => f.id)).toEqual(['b', 'c']);
    expect(page1.data[0]?.orgName).toBe('Colegio Dos');
    expect(page1.total).toBe(3);
    expect(page1.orgs).toEqual([
      { id: 'org-1', name: 'Colegio Uno', count: 1 },
      { id: 'org-2', name: 'Colegio Dos', count: 2 },
    ]);
  });

  it('consulta una sola org cuando se filtra por colegio', async () => {
    const captured = { values: [] as Record<string, unknown>[] };
    const service = new FeedbackService(
      makeDb(captured, [
        [
          { id: 'org-1', name: 'Colegio Uno' },
          { id: 'org-2', name: 'Colegio Dos' },
        ],
        [feedbackRow({ id: 'a' })],
      ]),
      filesStub,
      storageStub,
    );

    const result = await service.listAllOrgs({ page: 1, limit: 25, orgId: 'org-2' });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.orgId).toBe('org-2');
    // Sólo el colegio consultado aparece en las opciones del filtro.
    expect(result.orgs.map((o) => o.id)).toEqual(['org-2']);
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
