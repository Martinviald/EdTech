jest.mock('@soe/db', () => {
  const actual = jest.requireActual('@soe/db');
  return {
    __esModule: true,
    ...actual,
    withOrgContext: jest.fn((db: unknown, _orgId: string, fn: (tx: unknown) => unknown) => fn(db)),
  };
});

import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { documents, organizations, remedialMaterials, type Database, type Document } from '@soe/db';
import {
  materialLibraryQuerySchema,
  type MaterialLibraryQueryDto,
  type UserRole,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { RemedialService } from '../remedial/remedial.service';
import { DocumentLibraryService } from './document-library.service';
import { DocumentsService } from './documents.service';

const dialect = new PgDialect();

function render(condition: SQL | undefined): { sql: string; params: unknown[] } {
  if (!condition) throw new Error('condición vacía');
  return dialect.sqlToQuery(condition);
}

function makeUser(role: UserRole, overrides: Partial<JwtPayload> = {}): JwtPayload {
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

function libraryQuery(overrides: Partial<MaterialLibraryQueryDto> = {}): MaterialLibraryQueryDto {
  return { page: 1, pageSize: 20, ...overrides };
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
    content: { version: 1, blocks: [] },
    source: { kind: 'blank', refId: null },
    branding: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  } as Document;
}

function remedialRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rem-1',
    type: 'guide',
    status: 'ready',
    title: null,
    nodeId: 'node-1',
    nodeName: 'Fracciones',
    assessmentId: null,
    updatedAt: new Date('2026-01-03T00:00:00Z'),
    ...overrides,
  };
}

type SelectCall = { from?: unknown; where?: SQL; unionWith?: SelectCall };

function makeDb(results: unknown[][]) {
  const calls: SelectCall[] = [];
  let index = 0;

  const db = {
    select: () => {
      const call: SelectCall = {};
      calls.push(call);
      const rows = results[index] ?? [];
      index++;
      const chain = {
        call,
        from: (table: unknown) => {
          call.from = table;
          return chain;
        },
        leftJoin: () => chain,
        where: (condition: SQL) => {
          call.where = condition;
          return chain;
        },
        unionAll: (other: { call: SelectCall }) => {
          call.unionWith = other.call;
          return chain;
        },
        orderBy: () => chain,
        limit: () => chain,
        offset: () => chain,
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
      };
      return chain;
    },
  } as unknown as Database;

  return { db, calls };
}

function makeService(db: Database, scopeCondition: SQL | undefined = undefined) {
  const remedialService = {
    scopeCondition: jest.fn().mockResolvedValue(scopeCondition),
  } as unknown as RemedialService;
  return new DocumentLibraryService(db, new DocumentsService(db), remedialService);
}

describe('DocumentLibraryService.list — remediales condicionados por rol y flag', () => {
  it('con rol remedial y flag activo une documentos y remediales en el orden de la página', async () => {
    const forked = docRow({
      id: 'doc-forked',
      source: { kind: 'remedial', refId: 'rem-linked' },
    });
    const { db, calls } = makeDb([
      [{ config: {} }],
      [
        { kind: 'remedial', id: 'rem-1', updatedAt: new Date() },
        { kind: 'document', id: 'doc-forked', updatedAt: new Date() },
      ],
      [],
      [{ total: 4 }],
      [{ total: 2 }],
      [{ document: forked, createdByName: 'Ana' }],
      [remedialRow(), remedialRow({ id: 'rem-linked', status: 'approved', title: 'Guía IA' })],
    ]);

    const result = await makeService(db).list(makeUser('teacher'), libraryQuery());

    expect(calls[0]?.from).toBe(organizations);
    expect(calls[1]?.unionWith?.from).toBe(remedialMaterials);
    expect(result.total).toBe(6);
    expect(result.data).toEqual([
      {
        kind: 'remedial',
        id: 'rem-1',
        title: 'Material remedial — Fracciones',
        origin: 'remedial',
        remedial: { remedialMaterialId: 'rem-1', remedialType: 'guide', status: 'ready' },
        nodeId: 'node-1',
        assessmentId: null,
        updatedAt: '2026-01-03T00:00:00.000Z',
      },
      expect.objectContaining({
        kind: 'document',
        origin: 'remedial',
        remedial: { remedialMaterialId: 'rem-linked', remedialType: 'guide', status: 'approved' },
        document: expect.objectContaining({ id: 'doc-forked', createdByName: 'Ana' }),
      }),
    ]);
  });

  it('sin rol de REMEDIAL_VIEWER_ROLES no consulta el flag ni lista remediales', async () => {
    const forked = docRow({ source: { kind: 'remedial', refId: 'rem-linked' } });
    const { db, calls } = makeDb([
      [{ kind: 'document', id: 'doc-1', updatedAt: new Date() }],
      [{ total: 1 }],
      [{ document: forked, createdByName: null }],
    ]);

    const result = await makeService(db).list(makeUser('coordinator'), libraryQuery());

    expect(calls.map((call) => call.from)).toEqual([documents, documents, documents]);
    expect(calls[0]?.unionWith).toBeUndefined();
    expect(result.total).toBe(1);
    expect(result.data[0]).toEqual(expect.objectContaining({ kind: 'document', remedial: null }));
  });

  it('con el flag remedial deshabilitado en la org no lista remediales', async () => {
    const { db, calls } = makeDb([
      [{ config: { allowedFeatures: ['ai_analysis'] } }],
      [],
      [{ total: 0 }],
    ]);

    const result = await makeService(db).list(makeUser('teacher'), libraryQuery());

    expect(calls[1]?.from).toBe(documents);
    expect(calls[1]?.unionWith).toBeUndefined();
    expect(calls.some((call) => call.from === remedialMaterials)).toBe(false);
    expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
  });

  it('un origen distinto de remedial deja fuera a los remediales', async () => {
    const { db, calls } = makeDb([[{ config: {} }], [], [{ total: 0 }]]);

    await makeService(db).list(makeUser('teacher'), libraryQuery({ origin: 'instrument' }));

    expect(calls[1]?.unionWith).toBeUndefined();
    expect(render(calls[1]?.where).params).toContain('instrument');
  });
});

describe('DocumentLibraryService.list — condiciones de la rama remedial', () => {
  it('excluye remediales con documento vivo, y los estados failed y discarded', async () => {
    const { db, calls } = makeDb([[{ config: {} }], [], [], [{ total: 0 }], [{ total: 0 }]]);

    await makeService(db).list(makeUser('teacher'), libraryQuery());

    const remedialBranch = render(calls[1]?.unionWith?.where);
    expect(remedialBranch.sql).toContain(
      `not exists (select 1 from "documents" where "documents"."source"->>'kind' = 'remedial' and "documents"."source"->>'refId' = "remedial_materials"."id"::text and "documents"."deleted_at" is null`,
    );
    expect(remedialBranch.params).toEqual(
      expect.arrayContaining(['org-1', 'pending', 'processing', 'ready', 'approved']),
    );
    expect(remedialBranch.params).not.toContain('failed');
    expect(remedialBranch.params).not.toContain('discarded');
  });

  it('aplica el alcance docente que entrega RemedialService', async () => {
    const { db, calls } = makeDb([[{ config: {} }], [], [], [{ total: 0 }], [{ total: 0 }]]);

    await makeService(db, sql`scope_marker`).list(makeUser('teacher'), libraryQuery());

    expect(render(calls[1]?.unionWith?.where).sql).toContain('scope_marker');
  });
});

describe('DocumentLibraryService.list — filtro "Por revisar"', () => {
  it('pending_review deja remediales ready y documentos cuyo remedial sigue ready', async () => {
    const { db, calls } = makeDb([[{ config: {} }], [], [], [{ total: 0 }], [{ total: 0 }]]);

    await makeService(db).list(makeUser('teacher'), libraryQuery({ review: 'pending_review' }));

    const documentBranch = render(calls[1]?.where);
    expect(documentBranch.sql).toContain(
      `"documents"."source"->>'kind' = 'remedial' and exists (select 1 from "remedial_materials" where "remedial_materials"."id"::text = "documents"."source"->>'refId' and "remedial_materials"."status" = 'ready'`,
    );
    const remedialBranch = render(calls[1]?.unionWith?.where);
    expect(remedialBranch.sql).toContain('"remedial_materials"."status" = $');
    expect(remedialBranch.params.filter((param) => param === 'ready')).toHaveLength(2);
  });

  it('pending_review sin acceso a remediales no devuelve documentos', async () => {
    const { db, calls } = makeDb([[], [{ total: 0 }]]);

    await makeService(db).list(makeUser('coordinator'), libraryQuery({ review: 'pending_review' }));

    expect(render(calls[0]?.where).sql).toContain('false');
  });
});

describe('materialLibraryQuerySchema', () => {
  it('rechaza claves desconocidas', () => {
    expect(materialLibraryQuerySchema.safeParse({ limit: '10' }).success).toBe(false);
  });

  it('interpreta mine=false como falso y aplica la paginación por defecto', () => {
    expect(materialLibraryQuerySchema.parse({ mine: 'false', review: 'pending_review' })).toEqual({
      page: 1,
      pageSize: 20,
      mine: false,
      review: 'pending_review',
    });
  });
});
