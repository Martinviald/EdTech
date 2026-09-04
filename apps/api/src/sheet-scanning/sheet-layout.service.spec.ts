import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Database } from '@soe/db';
import { layoutHash, type ItemContent, type LayoutSpec } from '@soe/types';
import { SheetLayoutService } from './sheet-layout.service';
import { deriveLayoutDraft, type DerivableItem } from './sheet-layout.helpers';

jest.mock('@soe/types', () => {
  const actual = jest.requireActual<typeof import('@soe/types')>('@soe/types');
  return { ...actual, layoutHash: jest.fn(actual.layoutHash) };
});

const layoutHashMock = layoutHash as jest.MockedFunction<typeof layoutHash>;

const ORG_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const INSTRUMENT_ID = '11111111-1111-4111-8111-111111111111';

type QueryChain = {
  from: (..._: unknown[]) => QueryChain;
  where: (..._: unknown[]) => QueryChain;
  innerJoin: (..._: unknown[]) => QueryChain;
  leftJoin: (..._: unknown[]) => QueryChain;
  orderBy: (..._: unknown[]) => QueryChain;
  limit: (..._: unknown[]) => QueryChain;
  offset: (..._: unknown[]) => QueryChain;
  then: <T>(resolve: (rows: unknown[]) => T, reject?: (err: unknown) => unknown) => Promise<T>;
};

function makeDb(
  selectResults: unknown[][],
  insertReturning: unknown[][] = [],
): { db: Database; inserts: unknown[] } {
  let selectIdx = 0;
  let insertIdx = 0;
  const inserts: unknown[] = [];

  function chain(rows: unknown[]): QueryChain {
    const c: QueryChain = {
      from: () => c,
      where: () => c,
      innerJoin: () => c,
      leftJoin: () => c,
      orderBy: () => c,
      limit: () => c,
      offset: () => c,
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) as never,
    };
    return c;
  }

  const db = {
    select: () => chain(selectResults[selectIdx++] ?? []),
    insert: () => {
      const rows = insertReturning[insertIdx++] ?? [];
      return {
        values: (values: unknown) => {
          inserts.push(values);
          return {
            returning: () => Promise.resolve(rows),
            then: (resolve: (r: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
              Promise.resolve(rows).then(resolve, reject),
          };
        },
      };
    },
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  } as unknown as Database;

  return { db, inserts };
}

function mcItem(position: number, printedNumber: string | null = null): DerivableItem {
  return {
    id: `item-${position}`,
    position,
    printedNumber,
    type: 'multiple_choice',
    content: {
      stem: `Pregunta ${position}`,
      alternatives: ['A', 'B', 'C', 'D'].map((key) => ({
        key,
        text: `Alt ${key}`,
        isCorrect: key === 'A',
      })),
    } as ItemContent,
  };
}

function itemRow(item: DerivableItem): Record<string, unknown> {
  return {
    id: item.id,
    position: item.position,
    type: item.type,
    content: item.content,
    scoringConfig: item.printedNumber ? { printedNumber: item.printedNumber } : {},
  };
}

const INSTRUMENT_ROW = [{ id: INSTRUMENT_ID }];

function validItems(): DerivableItem[] {
  return [mcItem(1), mcItem(2), mcItem(3)];
}

function validSpec(items: DerivableItem[] = validItems()): LayoutSpec {
  return deriveLayoutDraft(INSTRUMENT_ID, items).spec;
}

function serviceForFreeze(
  items: DerivableItem[],
  insertReturning: unknown[][] = [[{ id: 'layout-1' }]],
  maxVersionRows: unknown[] = [{ maxVersion: 0 }],
): { service: SheetLayoutService; inserts: unknown[] } {
  const { db, inserts } = makeDb(
    [INSTRUMENT_ROW, items.map(itemRow), maxVersionRows],
    insertReturning,
  );
  return { service: new SheetLayoutService(db), inserts };
}

async function expectFreezeRejects(
  spec: LayoutSpec,
  items: DerivableItem[],
  invariant: number,
): Promise<void> {
  const { service } = serviceForFreeze(items);
  await expect(service.freeze(ORG_ID, USER_ID, spec)).rejects.toThrow(
    new RegExp(`Invariante ${invariant} violado`),
  );
}

afterEach(() => {
  layoutHashMock.mockClear();
});

describe('SheetLayoutService.deriveDraft', () => {
  it('deriva un borrador desde los ítems del instrumento', async () => {
    const items = validItems();
    const { db } = makeDb([INSTRUMENT_ROW, items.map(itemRow)]);
    const service = new SheetLayoutService(db);

    const draft = await service.deriveDraft(ORG_ID, INSTRUMENT_ID);

    expect(draft.spec.instrumentId).toBe(INSTRUMENT_ID);
    expect(draft.spec.fields.map((f) => f.printedNumber)).toEqual(['1', '2', '3']);
    expect(draft.excludedItems).toEqual([]);
  });

  it('lee el printedNumber desde scoringConfig cuando difiere de la posición', async () => {
    const items = [mcItem(1), mcItem(2, '14.1')];
    const { db } = makeDb([INSTRUMENT_ROW, items.map(itemRow)]);
    const service = new SheetLayoutService(db);

    const draft = await service.deriveDraft(ORG_ID, INSTRUMENT_ID);

    expect(draft.spec.fields.map((f) => f.printedNumber)).toEqual(['1', '14.1']);
  });

  it('rechaza un instrumento inexistente o invisible para la org', async () => {
    const { db } = makeDb([[]]);
    const service = new SheetLayoutService(db);

    await expect(service.deriveDraft(ORG_ID, INSTRUMENT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('SheetLayoutService.freeze — invariantes §3.1', () => {
  it('rechaza el invariante 1: printedNumber inexistente en el instrumento', async () => {
    const items = validItems();
    const spec = validSpec(items);
    spec.fields[0] = { ...spec.fields[0]!, printedNumber: '99' };
    await expectFreezeRejects(spec, items, 1);
  });

  it('rechaza el invariante 2: burbujas solapadas', async () => {
    const items = validItems();
    const spec = validSpec(items);
    const field = spec.fields[0]!;
    field.bubbles[1] = { ...field.bubbles[1]!, center: { ...field.bubbles[0]!.center } };
    await expectFreezeRejects(spec, items, 2);
  });

  it('rechaza el invariante 3: burbuja fuera del rango 0–1', async () => {
    const items = validItems();
    const spec = validSpec(items);
    const field = spec.fields[0]!;
    field.bubbles[0] = { ...field.bubbles[0]!, center: { x: 0.999, y: 0.5 } };
    await expectFreezeRejects(spec, items, 3);
  });

  it('rechaza el invariante 4: falta un ítem corregible', async () => {
    const items = validItems();
    const spec = validSpec(items);
    spec.fields = spec.fields.slice(0, 2);
    await expectFreezeRejects(spec, items, 4);
  });

  it('rechaza el invariante 5: pageIndex fuera de [0, pageCount)', async () => {
    const items = validItems();
    const spec = validSpec(items);
    spec.fields[2] = { ...spec.fields[2]!, pageIndex: 3 };
    await expectFreezeRejects(spec, items, 5);
  });

  it('rechaza el invariante 6: bubble_group sin burbujas', async () => {
    const items = validItems();
    const spec = validSpec(items);
    spec.fields[1] = { ...spec.fields[1]!, bubbles: [] };
    await expectFreezeRejects(spec, items, 6);
  });

  it('rechaza el invariante 7: hash inestable ante reordenamiento de claves', async () => {
    const items = validItems();
    const spec = validSpec(items);
    layoutHashMock.mockReturnValueOnce('aaaaaaaaaaaaaaaa').mockReturnValueOnce('bbbbbbbbbbbbbbbb');
    await expectFreezeRejects(spec, items, 7);
  });

  it('la excepción es BadRequestException con mensaje en español', async () => {
    const items = validItems();
    const spec = validSpec(items);
    spec.fields[0] = { ...spec.fields[0]!, printedNumber: '99' };
    const { service } = serviceForFreeze(items);

    await expect(service.freeze(ORG_ID, USER_ID, spec)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('SheetLayoutService.freeze — versionado', () => {
  it('congela con version = max(version) + 1 y devuelve el hash canónico', async () => {
    const items = validItems();
    const spec = validSpec(items);
    const { service, inserts } = serviceForFreeze(items, [[{ id: 'layout-9' }]], [
      { maxVersion: 4 },
    ]);

    const result = await service.freeze(ORG_ID, USER_ID, spec);

    expect(result).toEqual({
      layoutId: 'layout-9',
      version: 5,
      specHash: jest.requireActual<typeof import('@soe/types')>('@soe/types').layoutHash(spec),
    });
    expect(inserts[0]).toMatchObject({
      orgId: ORG_ID,
      instrumentId: INSTRUMENT_ID,
      version: 5,
      createdById: USER_ID,
    });
  });

  it('la primera versión de un instrumento es 1', async () => {
    const items = validItems();
    const spec = validSpec(items);
    const { service } = serviceForFreeze(items, [[{ id: 'layout-1' }]], [{ maxVersion: 0 }]);

    const result = await service.freeze(ORG_ID, USER_ID, spec);

    expect(result.version).toBe(1);
  });
});

describe('SheetLayoutService.getFrozen / list', () => {
  const layoutRow = {
    id: 'layout-1',
    orgId: ORG_ID,
    instrumentId: INSTRUMENT_ID,
    version: 2,
    spec: validSpec(),
    specHash: 'abcdefabcdefabcd',
    createdById: USER_ID,
    createdAt: new Date('2026-08-01T12:00:00Z'),
  };

  it('getFrozen devuelve el SheetLayoutModel completo', async () => {
    const { db } = makeDb([[layoutRow]]);
    const service = new SheetLayoutService(db);

    const model = await service.getFrozen(ORG_ID, 'layout-1');

    expect(model).toMatchObject({
      id: 'layout-1',
      instrumentId: INSTRUMENT_ID,
      version: 2,
      specHash: 'abcdefabcdefabcd',
      pageCount: 1,
      fieldCount: 3,
    });
    expect(model.spec).toEqual(layoutRow.spec);
  });

  it('getFrozen lanza NotFound cuando el layout no existe en la org', async () => {
    const { db } = makeDb([[]]);
    const service = new SheetLayoutService(db);

    await expect(service.getFrozen(ORG_ID, 'layout-x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list devuelve la envoltura paginada { data, total, page, limit }', async () => {
    const { db } = makeDb([[{ total: 7 }], [layoutRow]]);
    const service = new SheetLayoutService(db);

    const result = await service.list(ORG_ID, { page: 2, limit: 5 });

    expect(result.total).toBe(7);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(5);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 'layout-1', fieldCount: 3, pageCount: 1 });
    expect(result.data[0]).not.toHaveProperty('spec');
  });
});
