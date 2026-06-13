import { NotFoundException } from '@nestjs/common';
import type { Database } from '@soe/db';
import { StructuredCurriculumRetriever } from './structured-curriculum-retriever';

// El service usa `eq(taxonomyNodes.id, id)` para los lookups de un nodo. Mockeamos
// SOLO los operadores que usa el service para que `eq` devuelva un objeto con
// `.__id` (el DB mock identifica qué nodo se pide sin parsear SQL real). El resto
// de `drizzle-orm` se mantiene real con `requireActual` para no romper la carga de
// los schemas de `@soe/db` (que usa `relations`, `sql`, `pgTable`, …).
jest.mock('drizzle-orm', () => ({
  ...jest.requireActual('drizzle-orm'),
  eq: (_col: unknown, value: unknown) => ({ __id: value }),
  and: (...conds: unknown[]) => ({ __and: conds }),
  ne: (_col: unknown, value: unknown) => ({ __ne: value }),
  isNull: (_col: unknown) => ({ __isNull: true }),
}));

// ──────────────────────────────────────────────────────────────────────────────
// DB mock por intención de query (no por orden de llamada). El service ejecuta
// sus 4 loaders dentro de un `Promise.all`, por lo que el bucle de ancestros se
// intercala con descriptores/hermanos/items y el orden de consumo no es estable.
// Por eso el mock NO usa una cola global: clasifica cada query por las funciones
// encadenables que el service usa y devuelve filas de un store por escenario:
//
//   - innerJoin presente            → query de ítems etiquetados   → store.items
//   - orderBy presente, sin limit   → lista (descriptores/hermanos):
//        primer orderBy de la corrida → descriptores, segundo → hermanos
//   - limit(1), sin orderBy/join    → lookup de un nodo por id (findNode/ancestro):
//        se resuelve contra store.nodesById usando el id capturado en `where`.
//
// El id del lookup se captura del primer argumento de `where`, que en el service
// es `eq(taxonomyNodes.id, id)`; los tests pasan un `eq` mock que expone `.__id`.
// ──────────────────────────────────────────────────────────────────────────────

type Store = {
  nodesById: Record<string, unknown>;
  descriptors: unknown[];
  siblings: unknown[];
  items: unknown[];
};

type DbMock = Database & { __nodeLookups: number; __listCalls: number };

// Conteo de queries de lista por corrida, para mapear 1ª=descriptores, 2ª=hermanos.
function makeDb(store: Store): DbMock {
  let listCalls = 0;
  let nodeLookups = 0;

  function buildChain(): Record<string, unknown> {
    let capturedId: string | undefined;
    let hasOrderBy = false;
    let hasInnerJoin = false;
    let hasLimit = false;

    const resolve = (cb: (rows: unknown[]) => unknown): Promise<unknown> => {
      let rows: unknown[];
      if (hasInnerJoin) {
        rows = store.items;
      } else if (hasOrderBy && !hasLimit) {
        rows = listCalls === 0 ? store.descriptors : store.siblings;
        listCalls += 1;
      } else {
        // lookup de nodo por id
        nodeLookups += 1;
        const node = capturedId !== undefined ? store.nodesById[capturedId] : undefined;
        rows = node ? [node] : [];
      }
      return Promise.resolve(rows).then(cb);
    };

    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (cond: unknown) => {
        if (cond && typeof cond === 'object' && '__id' in cond) {
          capturedId = (cond as { __id?: string }).__id;
        }
        return chain;
      },
      innerJoin: () => {
        hasInnerJoin = true;
        return chain;
      },
      leftJoin: () => chain,
      orderBy: () => {
        hasOrderBy = true;
        return chain;
      },
      limit: () => {
        hasLimit = true;
        return chain;
      },
      then: (cb: (rows: unknown[]) => unknown) => resolve(cb),
    };
    return chain;
  }

  const db = {
    select: () => buildChain(),
    get __nodeLookups() {
      return nodeLookups;
    },
    get __listCalls() {
      return listCalls;
    },
  };

  return db as unknown as DbMock;
}

const baseNode = {
  id: 'node-leaf',
  code: 'OA-01',
  name: 'Comprender textos',
  description: 'Desc del nodo',
  type: 'learning_objective',
  parentId: 'node-axis',
};

function emptyStore(partial: Partial<Store> = {}): Store {
  return {
    nodesById: {},
    descriptors: [],
    siblings: [],
    items: [],
    ...partial,
  };
}

function makeRetriever(store: Store): {
  retriever: StructuredCurriculumRetriever;
  db: DbMock;
} {
  const db = makeDb(store);
  const retriever = new StructuredCurriculumRetriever(db);
  return { retriever, db };
}

describe('StructuredCurriculumRetriever', () => {
  // CA2 — nodo inexistente → NotFoundException
  it('lanza NotFoundException si el nodo no existe', async () => {
    const { retriever } = makeRetriever(emptyStore()); // nodesById vacío → findNode []
    await expect(retriever.getContext('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  // CA1 — devuelve el nodo mapeado a TaxonomyNodeRef (sin parentId expuesto)
  it('devuelve el nodo solicitado mapeado a TaxonomyNodeRef', async () => {
    const { retriever } = makeRetriever(
      emptyStore({
        nodesById: {
          'node-leaf': baseNode,
          'node-axis': { ...baseNode, id: 'node-axis', parentId: null, name: 'Eje', code: 'EJE' },
        },
      }),
    );

    const ctx = await retriever.getContext('node-leaf');
    expect(ctx.node).toEqual({
      id: 'node-leaf',
      code: 'OA-01',
      name: 'Comprender textos',
      description: 'Desc del nodo',
      type: 'learning_objective',
    });
    expect(ctx.node).not.toHaveProperty('parentId');
  });

  // CA1 — ancestros ordenados de raíz → padre
  it('devuelve los ancestros ordenados de raíz a padre', async () => {
    const axis = { id: 'node-axis', code: 'EJE', name: 'Eje', description: null, type: 'axis', parentId: 'node-root' };
    const root = { id: 'node-root', code: null, name: 'Raíz', description: null, type: 'domain', parentId: null };

    const { retriever } = makeRetriever(
      emptyStore({
        nodesById: { 'node-leaf': baseNode, 'node-axis': axis, 'node-root': root },
      }),
    );

    const ctx = await retriever.getContext('node-leaf');
    expect(ctx.ancestors.map((a) => a.id)).toEqual(['node-root', 'node-axis']);
  });

  // CA1 — descriptores = hijos directos
  it('devuelve los descriptores (hijos directos)', async () => {
    const child1 = { id: 'c1', code: 'D1', name: 'Descriptor 1', description: null, type: 'descriptor', parentId: 'node-leaf' };
    const child2 = { id: 'c2', code: 'D2', name: 'Descriptor 2', description: null, type: 'descriptor', parentId: 'node-leaf' };

    const { retriever } = makeRetriever(
      emptyStore({
        nodesById: {
          'node-leaf': baseNode,
          'node-axis': { ...baseNode, id: 'node-axis', parentId: null },
        },
        descriptors: [child1, child2],
      }),
    );

    const ctx = await retriever.getContext('node-leaf');
    expect(ctx.descriptors.map((d) => d.id)).toEqual(['c1', 'c2']);
    expect(ctx.descriptors[0]).not.toHaveProperty('parentId');
  });

  // CA1 — hermanos = mismo parentId, sin el propio nodo
  it('devuelve los hermanos (mismo parentId, excluido el propio nodo)', async () => {
    const sib = { id: 'sib-1', code: 'S1', name: 'Hermano', description: null, type: 'learning_objective', parentId: 'node-axis' };

    const { retriever } = makeRetriever(
      emptyStore({
        nodesById: {
          'node-leaf': baseNode,
          'node-axis': { ...baseNode, id: 'node-axis', parentId: null },
        },
        siblings: [sib],
      }),
    );

    const ctx = await retriever.getContext('node-leaf');
    expect(ctx.siblings.map((s) => s.id)).toEqual(['sib-1']);
  });

  // CA1 — ítems etiquetados con stem extraído de content
  it('devuelve los ítems etiquetados extrayendo stem de content', async () => {
    const { retriever } = makeRetriever(
      emptyStore({
        nodesById: {
          'node-leaf': baseNode,
          'node-axis': { ...baseNode, id: 'node-axis', parentId: null },
        },
        items: [
          { itemId: 'i1', position: 1, type: 'multiple_choice', content: { stem: '¿Cuál es la idea principal?' } },
          { itemId: 'i2', position: 2, type: 'open_ended', content: {} },
          { itemId: 'i3', position: 3, type: 'multiple_choice', content: { stem: 42 } }, // stem no-string → null
        ],
      }),
    );

    const ctx = await retriever.getContext('node-leaf');
    expect(ctx.taggedItems).toEqual([
      { itemId: 'i1', position: 1, type: 'multiple_choice', stem: '¿Cuál es la idea principal?' },
      { itemId: 'i2', position: 2, type: 'open_ended', stem: null },
      { itemId: 'i3', position: 3, type: 'multiple_choice', stem: null },
    ]);
  });

  // CA1 — contexto completo y tipado en un solo nodo
  it('arma el CurriculumContext completo con todas las secciones', async () => {
    const axis = { id: 'node-axis', code: 'EJE', name: 'Eje', description: null, type: 'axis', parentId: null };
    const child = { id: 'c1', code: 'D1', name: 'Descriptor', description: null, type: 'descriptor', parentId: 'node-leaf' };
    const sib = { id: 'sib-1', code: 'S1', name: 'Hermano', description: null, type: 'learning_objective', parentId: 'node-axis' };

    const { retriever } = makeRetriever(
      emptyStore({
        nodesById: { 'node-leaf': baseNode, 'node-axis': axis },
        descriptors: [child],
        siblings: [sib],
        items: [{ itemId: 'i1', position: 1, type: 'multiple_choice', content: { stem: 'Enunciado' } }],
      }),
    );

    const ctx = await retriever.getContext('node-leaf');
    expect(ctx.node.id).toBe('node-leaf');
    expect(ctx.ancestors).toHaveLength(1);
    expect(ctx.descriptors).toHaveLength(1);
    expect(ctx.siblings).toHaveLength(1);
    expect(ctx.taggedItems).toHaveLength(1);
  });

  // CA3 — nodo raíz → ancestros y hermanos vacíos sin romper
  it('para un nodo raíz devuelve ancestors y siblings vacíos', async () => {
    const rootNode = {
      id: 'node-root',
      code: null,
      name: 'Raíz',
      description: null,
      type: 'domain',
      parentId: null,
    };

    const { retriever, db } = makeRetriever(
      emptyStore({ nodesById: { 'node-root': rootNode } }),
    );

    const ctx = await retriever.getContext('node-root');
    expect(ctx.ancestors).toEqual([]);
    expect(ctx.siblings).toEqual([]);
    expect(ctx.descriptors).toEqual([]);
    expect(ctx.taggedItems).toEqual([]);
    // Solo findNode hace lookup de nodo: parentId null → loadAncestors no consulta.
    expect(db.__nodeLookups).toBe(1);
    // Solo descriptores entra a la rama de lista (loadSiblings retorna [] sin query).
    expect(db.__listCalls).toBe(1);
  });

  // CA3/robustez — corta el loop de ancestros ante un ciclo en parentId
  it('no entra en bucle infinito si los parentId forman un ciclo', async () => {
    const leaf = { ...baseNode, parentId: 'a' };
    const a = { id: 'a', code: null, name: 'A', description: null, type: 'axis', parentId: 'b' };
    const b = { id: 'b', code: null, name: 'B', description: null, type: 'axis', parentId: 'a' };

    const { retriever } = makeRetriever(
      emptyStore({ nodesById: { 'node-leaf': leaf, a, b } }),
    );

    const ctx = await retriever.getContext('node-leaf');
    // sube a 'a' (parentId b), luego a 'b' (parentId a → ya visitado, corta).
    // chain padre→raíz = [a, b]; invertido = [b, a].
    expect(ctx.ancestors.map((x) => x.id)).toEqual(['b', 'a']);
  });
});
