import { ForbiddenException } from '@nestjs/common';
import { ItemCollectionsService } from './item-collections.service';
import type { JwtPayload } from '../auth/jwt-payload.types';

function makeService() {
  return new ItemCollectionsService({} as never, {} as never, {} as never);
}

type QueryBuilder = {
  from: (..._: unknown[]) => QueryBuilder;
  where: (..._: unknown[]) => QueryBuilder;
  leftJoin: (..._: unknown[]) => QueryBuilder;
  orderBy: (..._: unknown[]) => QueryBuilder;
  then: <T>(resolve: (rows: T[]) => unknown) => Promise<unknown>;
};

function makeDb(selectResults: unknown[][]) {
  let selectIdx = 0;

  function buildSelectChain(rows: unknown[]): QueryBuilder {
    const chain: QueryBuilder = {
      from: () => chain,
      where: () => chain,
      leftJoin: () => chain,
      orderBy: () => chain,
      then: (resolve) => Promise.resolve(rows as never).then(resolve as never),
    };
    return chain;
  }

  return {
    select: () => {
      const rows = selectResults[selectIdx] ?? [];
      selectIdx++;
      return buildSelectChain(rows);
    },
  } as never;
}

function itemRow(id: string, instrumentId: string | null) {
  return {
    id,
    orgId: 'org-1',
    instrumentId,
    sectionId: null,
    position: 3,
    type: 'multiple_choice',
    content: { stem: 'Enunciado' },
    scoringConfig: null,
    irtParams: null,
    status: 'active',
    version: 1,
    source: 'manual',
    difficulty: null,
    createdById: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function user(overrides: Partial<JwtPayload> = {}): JwtPayload {
  const role = overrides.activeRole ?? overrides.role ?? 'school_admin';
  return {
    userId: 'u1',
    orgId: 'org-1',
    email: 'a@b.cl',
    name: 'Test',
    roles: [role],
    activeRole: role,
    role,
    isPlatformAdmin: false,
    ...overrides,
  };
}

describe('ItemCollectionsService', () => {
  describe('sin org activa (multi-tenancy)', () => {
    const service = makeService();
    const noOrg = user({ orgId: null });

    it('list rechaza con ForbiddenException', async () => {
      await expect(service.list(noOrg, { page: 1, limit: 50 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('create rechaza con ForbiddenException', async () => {
      await expect(service.create({ name: 'Lista' }, noOrg)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('getById rechaza con ForbiddenException', async () => {
      await expect(service.getById('c1', noOrg)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('addItems rechaza con ForbiddenException', async () => {
      await expect(service.addItems('c1', { itemIds: ['i1'] }, noOrg)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('materialize rechaza con ForbiddenException', async () => {
      await expect(service.materialize('c1', {}, noOrg)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getById', () => {
    const collectionRow = {
      id: 'c1',
      orgId: 'org-1',
      name: 'Lista',
      description: null,
      createdById: 'u1',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    function makeServiceWithRows(rows: unknown[]) {
      const tags = [{ id: 't1', itemId: 'i1', nodeId: 'n1' }];
      const items = {
        findTagsByItemIds: jest.fn().mockResolvedValue(new Map([['i1', tags]])),
      };
      const db = makeDb([[collectionRow], rows]);
      return {
        service: new ItemCollectionsService(db, items as never, {} as never),
        items,
        tags,
      };
    }

    it('adjunta el nombre del instrumento y los tags de taxonomía a cada ítem', async () => {
      const { service, items, tags } = makeServiceWithRows([
        {
          link: {
            id: 'l1',
            collectionId: 'c1',
            itemId: 'i1',
            position: 0,
            createdAt: new Date(),
          },
          item: itemRow('i1', 'inst-1'),
          instrumentName: 'DIA Lectura 5° básico',
        },
      ]);

      const result = await service.getById('c1', user());

      expect(items.findTagsByItemIds).toHaveBeenCalledWith(['i1']);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.instrumentName).toBe('DIA Lectura 5° básico');
      expect(result.items[0]?.item?.tags).toEqual(tags);
    });

    it('tolera un ítem borrado: entrada sin ítem y sin instrumento', async () => {
      const { service, items } = makeServiceWithRows([
        {
          link: {
            id: 'l2',
            collectionId: 'c1',
            itemId: 'i-borrado',
            position: 0,
            createdAt: new Date(),
          },
          item: null,
          instrumentName: null,
        },
      ]);

      const result = await service.getById('c1', user());

      expect(items.findTagsByItemIds).toHaveBeenCalledWith([]);
      expect(result.items[0]?.item).toBeNull();
      expect(result.items[0]?.instrumentName).toBeNull();
    });
  });
});
