import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

jest.mock('@soe/db', () => {
  const actual = jest.requireActual('@soe/db');
  return {
    __esModule: true,
    ...actual,
    withOrgContext: jest.fn(
      (db: unknown, _orgId: string, fn: (tx: unknown) => unknown) => fn(db),
    ),
  };
});

import { documentItemRefs, documents, type Database, type Document } from '@soe/db';
import type { Block, DocumentContent, DocumentListQueryDto, UserRole } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { DocumentsService } from './documents.service';

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  const role: UserRole = overrides.activeRole ?? 'teacher';
  return {
    userId: 'user-1',
    orgId: 'org-1',
    email: 't@x.cl',
    name: 'Tester',
    isPlatformAdmin: false,
    roles: [role],
    activeRole: role,
    role,
    ...overrides,
  };
}

function itemBlock(id: string, itemId: string): Block {
  return {
    id,
    type: 'item',
    itemId,
    showAnswer: false,
    snapshot: { type: 'multiple_choice', version: 1, content: {} },
  };
}

function makeContent(blocks: Block[]): DocumentContent {
  return { version: 1, blocks };
}

function docRow(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    orgId: 'org-1',
    createdById: 'user-1',
    title: 'Guía de fracciones',
    type: 'guide',
    status: 'draft',
    visibility: 'org',
    subjectId: null,
    gradeId: null,
    nodeId: null,
    instrumentId: null,
    content: makeContent([]),
    source: { kind: 'blank', refId: null },
    branding: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  } as Document;
}

function listQuery(overrides: Partial<DocumentListQueryDto> = {}): DocumentListQueryDto {
  return { page: 1, pageSize: 20, ...overrides };
}

type WriteCall = { table: unknown; values?: unknown; set?: Record<string, unknown> };

function makeDb(selects: unknown[][], returning: unknown[][] = []) {
  let selectIdx = 0;
  let returningIdx = 0;
  const insertCalls: WriteCall[] = [];
  const updateCalls: WriteCall[] = [];
  const deleteCalls: WriteCall[] = [];

  function selectChain(rows: unknown[]) {
    const chain = {
      from: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      offset: () => chain,
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return chain;
  }

  function writeChain() {
    return {
      returning: async () => {
        const rows = returning[returningIdx] ?? [];
        returningIdx++;
        return rows;
      },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(undefined).then(resolve),
    };
  }

  const db = {
    select: () => {
      const rows = selects[selectIdx] ?? [];
      selectIdx++;
      return selectChain(rows);
    },
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        insertCalls.push({ table, values });
        return writeChain();
      },
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => {
        updateCalls.push({ table, set });
        return { where: () => writeChain() };
      },
    }),
    delete: (table: unknown) => {
      deleteCalls.push({ table });
      return { where: async () => undefined };
    },
  } as unknown as Database;

  return { db, insertCalls, updateCalls, deleteCalls };
}

function makeService(db: Database): DocumentsService {
  return new DocumentsService(db);
}

describe('DocumentsService.get', () => {
  it('devuelve el documento propio aunque sea privado, con fechas ISO y autor', async () => {
    const row = docRow({ visibility: 'private' });
    const { db } = makeDb([[{ document: row, createdByName: 'Tester' }]]);

    const result = await makeService(db).get(makeUser(), 'doc-1');

    expect(result.id).toBe('doc-1');
    expect(result.createdByName).toBe('Tester');
    expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.updatedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('lanza NotFound para un documento privado de otro usuario', async () => {
    const row = docRow({ createdById: 'other-user', visibility: 'private' });
    const { db } = makeDb([[{ document: row, createdByName: 'Otra' }]]);

    await expect(makeService(db).get(makeUser(), 'doc-1')).rejects.toThrow(NotFoundException);
  });

  it('devuelve un documento de plataforma (orgId null) con visibility platform', async () => {
    const row = docRow({ orgId: null, createdById: 'other-user', visibility: 'platform' });
    const { db } = makeDb([[{ document: row, createdByName: 'Plataforma' }]]);

    const result = await makeService(db).get(makeUser(), 'doc-1');

    expect(result.orgId).toBeNull();
  });

  it('lanza NotFound para un documento orgId null que no es platform', async () => {
    const row = docRow({ orgId: null, createdById: 'other-user', visibility: 'org' });
    const { db } = makeDb([[{ document: row, createdByName: 'Otra' }]]);

    await expect(makeService(db).get(makeUser(), 'doc-1')).rejects.toThrow(NotFoundException);
  });

  it('lanza Forbidden si el usuario no tiene organización activa', async () => {
    const { db } = makeDb([]);

    await expect(makeService(db).get(makeUser({ orgId: null }), 'doc-1')).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('DocumentsService.update', () => {
  it('lanza Forbidden con sugerencia de duplicar al editar un documento ajeno', async () => {
    const row = docRow({ createdById: 'other-user', visibility: 'org' });
    const { db } = makeDb([[{ document: row, createdByName: 'Otra' }]]);

    await expect(
      makeService(db).update(makeUser(), 'doc-1', { title: 'Nuevo' }),
    ).rejects.toThrow(
      'Solo el creador puede editar este material. Duplícalo para hacer tu propia versión.',
    );
  });

  it('permite a platform_admin editar un documento ajeno', async () => {
    const row = docRow({ createdById: 'other-user', visibility: 'org' });
    const { db } = makeDb(
      [[{ document: row, createdByName: 'Otra' }]],
      [[docRow({ createdById: 'other-user', title: 'Nuevo' })]],
    );
    const admin = makeUser({ isPlatformAdmin: true, activeRole: 'platform_admin' });

    const result = await makeService(db).update(admin, 'doc-1', { title: 'Nuevo' });

    expect(result.title).toBe('Nuevo');
  });

  it('con content nuevo valida los ítems y recalcula las refs sin duplicados', async () => {
    const newContent = makeContent([
      itemBlock('b1', 'item-1'),
      itemBlock('b2', 'item-2'),
      itemBlock('b3', 'item-1'),
    ]);
    const { db, insertCalls, updateCalls, deleteCalls } = makeDb(
      [
        [{ document: docRow(), createdByName: 'Tester' }],
        [{ id: 'item-1' }, { id: 'item-2' }],
      ],
      [[docRow({ content: newContent })]],
    );

    const result = await makeService(db).update(makeUser(), 'doc-1', { content: newContent });

    expect(updateCalls[0].table).toBe(documents);
    expect(updateCalls[0].set?.content).toEqual(newContent);
    expect(updateCalls[0].set?.updatedAt).toBeInstanceOf(Date);
    expect(deleteCalls).toEqual([{ table: documentItemRefs }]);
    expect(insertCalls).toEqual([
      {
        table: documentItemRefs,
        values: [
          { orgId: 'org-1', documentId: 'doc-1', itemId: 'item-1' },
          { orgId: 'org-1', documentId: 'doc-1', itemId: 'item-2' },
        ],
      },
    ]);
    expect(result.content).toEqual(newContent);
  });

  it('rechaza content que referencia ítems inexistentes o no visibles', async () => {
    const newContent = makeContent([itemBlock('b1', 'item-1'), itemBlock('b2', 'item-x')]);
    const { db, deleteCalls } = makeDb([
      [{ document: docRow(), createdByName: 'Tester' }],
      [{ id: 'item-1' }],
    ]);

    await expect(
      makeService(db).update(makeUser(), 'doc-1', { content: newContent }),
    ).rejects.toThrow(BadRequestException);
    expect(deleteCalls).toEqual([]);
  });

  it('sin content no toca las refs', async () => {
    const { db, insertCalls, deleteCalls } = makeDb(
      [[{ document: docRow(), createdByName: 'Tester' }]],
      [[docRow({ title: 'Renombrada' })]],
    );

    await makeService(db).update(makeUser(), 'doc-1', { title: 'Renombrada' });

    expect(deleteCalls).toEqual([]);
    expect(insertCalls).toEqual([]);
  });
});

describe('DocumentsService.remove', () => {
  it('hace soft-delete seteando deletedAt', async () => {
    const { db, updateCalls } = makeDb([[{ document: docRow(), createdByName: 'Tester' }]]);

    await makeService(db).remove(makeUser(), 'doc-1');

    expect(updateCalls[0].table).toBe(documents);
    expect(updateCalls[0].set?.deletedAt).toBeInstanceOf(Date);
    expect(updateCalls[0].set?.updatedAt).toBeInstanceOf(Date);
  });

  it('lanza Forbidden al borrar un documento ajeno', async () => {
    const row = docRow({ createdById: 'other-user' });
    const { db, updateCalls } = makeDb([[{ document: row, createdByName: 'Otra' }]]);

    await expect(makeService(db).remove(makeUser(), 'doc-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(updateCalls).toEqual([]);
  });
});

describe('DocumentsService.duplicate', () => {
  it('crea una copia propia con los campos correctos y recalcula sus refs', async () => {
    const sourceContent = makeContent([itemBlock('b1', 'item-1')]);
    const original = docRow({
      createdById: 'other-user',
      title: 'Guía compartida',
      status: 'published',
      visibility: 'org',
      subjectId: 'subj-1',
      gradeId: 'grade-1',
      nodeId: 'node-1',
      instrumentId: 'inst-1',
      content: sourceContent,
      source: { kind: 'remedial', refId: 'rem-1' },
    });
    const copy = docRow({
      id: 'doc-2',
      title: 'Guía compartida (copia)',
      content: sourceContent,
      source: { kind: 'document', refId: 'doc-1' },
    });
    const { db, insertCalls, deleteCalls } = makeDb(
      [[{ document: original, createdByName: 'Otra' }]],
      [[copy]],
    );

    const result = await makeService(db).duplicate(makeUser(), 'doc-1');

    expect(insertCalls[0].table).toBe(documents);
    expect(insertCalls[0].values).toEqual({
      orgId: 'org-1',
      createdById: 'user-1',
      title: 'Guía compartida (copia)',
      type: 'guide',
      status: 'draft',
      visibility: 'org',
      subjectId: 'subj-1',
      gradeId: 'grade-1',
      nodeId: 'node-1',
      instrumentId: null,
      content: sourceContent,
      source: { kind: 'document', refId: 'doc-1' },
      branding: null,
    });
    expect(deleteCalls).toEqual([{ table: documentItemRefs }]);
    expect(insertCalls[1]).toEqual({
      table: documentItemRefs,
      values: [{ orgId: 'org-1', documentId: 'doc-2', itemId: 'item-1' }],
    });
    expect(result.id).toBe('doc-2');
    expect(result.title).toBe('Guía compartida (copia)');
  });

  it('lanza NotFound al duplicar un documento privado ajeno', async () => {
    const row = docRow({ createdById: 'other-user', visibility: 'private' });
    const { db } = makeDb([[{ document: row, createdByName: 'Otra' }]]);

    await expect(makeService(db).duplicate(makeUser(), 'doc-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('DocumentsService.create', () => {
  it('crea el documento con orgId/createdById del token y source blank', async () => {
    const inserted = docRow({ title: 'Nueva guía' });
    const { db, insertCalls } = makeDb([], [[inserted]]);

    const result = await makeService(db).create(makeUser(), {
      title: 'Nueva guía',
      type: 'guide',
    });

    expect(insertCalls[0].table).toBe(documents);
    expect(insertCalls[0].values).toEqual({
      orgId: 'org-1',
      createdById: 'user-1',
      title: 'Nueva guía',
      type: 'guide',
      content: { version: 1, blocks: [] },
      subjectId: null,
      gradeId: null,
      nodeId: null,
      source: { kind: 'blank', refId: null },
    });
    expect(result.createdByName).toBe('Tester');
  });

  it('con content con ítems valida su visibilidad e inserta las refs', async () => {
    const content = makeContent([itemBlock('b1', 'item-1')]);
    const inserted = docRow({ content });
    const { db, insertCalls } = makeDb([[{ id: 'item-1' }]], [[inserted]]);

    await makeService(db).create(makeUser(), {
      title: 'Guía con ítems',
      type: 'worksheet',
      content,
    });

    expect(insertCalls[1]).toEqual({
      table: documentItemRefs,
      values: [{ orgId: 'org-1', documentId: 'doc-1', itemId: 'item-1' }],
    });
  });
});

describe('DocumentsService.list', () => {
  it('pagina y mapea a list items sin content, con blockCount e itemCount', async () => {
    const row = docRow({
      content: makeContent([
        itemBlock('b1', 'item-1'),
        { id: 'b2', type: 'divider' },
      ]),
    });
    const { db } = makeDb([
      [{ document: row, createdByName: 'Ana' }],
      [{ total: 7 }],
    ]);

    const result = await makeService(db).list(makeUser(), listQuery({ page: 2, pageSize: 5 }));

    expect(result.total).toBe(7);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(5);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].blockCount).toBe(2);
    expect(result.data[0].itemCount).toBe(1);
    expect(result.data[0].createdByName).toBe('Ana');
    expect('content' in result.data[0]).toBe(false);
  });
});
