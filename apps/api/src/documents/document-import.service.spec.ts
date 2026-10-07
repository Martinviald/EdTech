jest.mock('@soe/db', () => {
  const actual = jest.requireActual('@soe/db');
  return {
    __esModule: true,
    ...actual,
    withOrgContext: jest.fn((db: unknown, _orgId: string, fn: (tx: unknown) => unknown) => fn(db)),
  };
});

import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database, Document, RemedialMaterial } from '@soe/db';
import type { DocumentModel } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { DocumentImportService } from './document-import.service';
import { DocumentsService } from './documents.service';

const dialect = new PgDialect();

const user: JwtPayload = {
  userId: 'user-1',
  orgId: 'org-1',
  email: 't@x.cl',
  name: 'Tester',
  isPlatformAdmin: false,
  roles: ['teacher'],
  activeRole: 'teacher',
  role: 'teacher',
};

const material = {
  id: 'rem-1',
  orgId: 'org-1',
  type: 'guide',
  status: 'approved',
  nodeId: null,
  title: 'Guía de fracciones',
  content: {
    objective: 'Comparar fracciones',
    rootCauseSummary: 'Confunden numerador y denominador',
    strategy: 'Material concreto',
    classActivities: [{ title: 'Tiras', description: 'Doblar tiras', durationMin: 20 }],
    materials: [],
    successCriteria: [],
  },
  editedContent: null,
  deletedAt: null,
} as unknown as RemedialMaterial;

const insertedDocument = {
  id: 'doc-1',
  orgId: 'org-1',
  content: { version: 1, blocks: [] },
} as unknown as Document;

function makeDb(selects: unknown[][]) {
  let index = 0;
  const executed: SQL[] = [];
  const inserts: unknown[] = [];

  const chain = (rows: unknown[]) => {
    const builder = {
      from: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return builder;
  };

  const db = {
    execute: async (query: SQL) => {
      executed.push(query);
    },
    select: () => {
      const rows = selects[index] ?? [];
      index++;
      return chain(rows);
    },
    insert: () => ({
      values: (values: unknown) => {
        inserts.push(values);
        return { returning: async () => [insertedDocument] };
      },
    }),
    delete: () => ({ where: async () => undefined }),
  } as unknown as Database;

  return { db, executed, inserts };
}

function makeService(db: Database) {
  const documentsService = new DocumentsService(db);
  jest
    .spyOn(documentsService, 'get')
    .mockImplementation(async (_user, id) => ({ id }) as DocumentModel);
  return new DocumentImportService(db, documentsService);
}

describe('DocumentImportService.fromRemedial — deduplicación', () => {
  it('la segunda llamada devuelve el mismo documento sin crear otro', async () => {
    const { db, executed, inserts } = makeDb([[], [material], [{ id: 'doc-1' }]]);
    const service = makeService(db);

    const first = await service.fromRemedial(user, 'rem-1');
    const second = await service.fromRemedial(user, 'rem-1');

    expect(first.id).toBe('doc-1');
    expect(second.id).toBe('doc-1');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual(
      expect.objectContaining({ source: { kind: 'remedial', refId: 'rem-1' } }),
    );
    expect(executed).toHaveLength(2);
  });

  it('toma un advisory lock transaccional por remedial antes de buscar el documento', async () => {
    const { db, executed } = makeDb([[{ id: 'doc-existente' }]]);

    const result = await makeService(db).fromRemedial(user, 'rem-9');

    expect(result.id).toBe('doc-existente');
    const lock = dialect.sqlToQuery(executed[0] as SQL);
    expect(lock.sql).toBe('select pg_advisory_xact_lock(hashtext($1))');
    expect(lock.params).toEqual(['documents:from-remedial:rem-9']);
  });
});
