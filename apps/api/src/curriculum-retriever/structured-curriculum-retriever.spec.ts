import { NotFoundException } from '@nestjs/common';
import type { Database } from '@soe/db';
import { instruments, items, itemTaxonomyTags, taxonomyNodes } from '@soe/db';
import { StructuredCurriculumRetriever } from './structured-curriculum-retriever';

// Mockeamos SOLO los operadores de condición que usa el retriever para que
// devuelvan descriptores de predicado inspeccionables. El resto de `drizzle-orm`
// (pgTable, relations, sql, …) se mantiene real con `requireActual` para no romper
// la carga de los schemas de `@soe/db` (las columnas siguen siendo objetos reales,
// comparables por identidad en el evaluador de abajo).
jest.mock('drizzle-orm', () => ({
  ...jest.requireActual('drizzle-orm'),
  eq: (col: unknown, val: unknown) => ({ __pred: 'eq', col, val }),
  ne: (col: unknown, val: unknown) => ({ __pred: 'ne', col, val }),
  isNull: (col: unknown) => ({ __pred: 'isNull', col }),
  inArray: (col: unknown, vals: unknown) => ({ __pred: 'in', col, vals }),
  or: (...conds: unknown[]) => ({ __pred: 'or', conds }),
  and: (...conds: unknown[]) => ({ __pred: 'and', conds }),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Fake DB con un mini-evaluador de queries en memoria. NO mockea la lógica bajo
// prueba (extracción, filtros, fallback): ejecuta de verdad los predicados que el
// retriever construye contra un store en memoria (taxonomy_nodes ⨝ items ⨝
// instruments), aplicando WHERE / orderBy / limit. Así los tests de filtro por
// asignatura/nivel, por org y de fallback son de comportamiento real.
// ──────────────────────────────────────────────────────────────────────────────

type NodeRow = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  type: string;
  parentId: string | null;
  subjectId: string | null;
  gradeId: string | null;
  order: number;
};

type ItemRow = {
  id: string;
  position: number;
  type: string;
  content: unknown;
  status: string;
  deletedAt: Date | null;
  orgId: string | null;
  instrumentId: string | null;
};

type TagRow = { itemId: string; nodeId: string };
type InstrumentRow = { id: string; subjectId: string | null; gradeId: string | null };

type Store = {
  nodes: NodeRow[];
  items: ItemRow[];
  tags: TagRow[];
  instruments: InstrumentRow[];
};

type JoinedRow = { tag: TagRow; item: ItemRow; instrument: InstrumentRow | null };

interface Pred {
  __pred: string;
  col?: unknown;
  val?: unknown;
  vals?: unknown;
  conds?: unknown[];
}

function isPred(value: unknown): value is Pred {
  return Boolean(value) && typeof value === 'object' && '__pred' in (value as object);
}

/** Evalúa un árbol de predicados contra una fila, usando el resolvedor de columnas. */
function evalPred(pred: unknown, resolve: (col: unknown) => unknown): boolean {
  if (!isPred(pred)) return true; // sin WHERE → matchea todo
  switch (pred.__pred) {
    case 'eq':
      return resolve(pred.col) === pred.val;
    case 'ne':
      return resolve(pred.col) !== pred.val;
    case 'isNull': {
      const v = resolve(pred.col);
      return v === null || v === undefined;
    }
    case 'in':
      return Array.isArray(pred.vals) && pred.vals.includes(resolve(pred.col));
    case 'or':
      return (pred.conds ?? []).some((c) => evalPred(c, resolve));
    case 'and':
      return (pred.conds ?? []).every((c) => evalPred(c, resolve));
    default:
      return true;
  }
}

function resolveForNode(col: unknown, node: NodeRow): unknown {
  if (col === taxonomyNodes.id) return node.id;
  if (col === taxonomyNodes.code) return node.code;
  if (col === taxonomyNodes.name) return node.name;
  if (col === taxonomyNodes.description) return node.description;
  if (col === taxonomyNodes.type) return node.type;
  if (col === taxonomyNodes.parentId) return node.parentId;
  if (col === taxonomyNodes.subjectId) return node.subjectId;
  if (col === taxonomyNodes.gradeId) return node.gradeId;
  if (col === taxonomyNodes.order) return node.order;
  return undefined;
}

function resolveForItem(col: unknown, j: JoinedRow): unknown {
  if (col === itemTaxonomyTags.nodeId) return j.tag.nodeId;
  if (col === itemTaxonomyTags.itemId) return j.tag.itemId;
  if (col === items.id) return j.item.id;
  if (col === items.position) return j.item.position;
  if (col === items.type) return j.item.type;
  if (col === items.content) return j.item.content;
  if (col === items.status) return j.item.status;
  if (col === items.deletedAt) return j.item.deletedAt ?? null;
  if (col === items.orgId) return j.item.orgId ?? null;
  if (col === items.instrumentId) return j.item.instrumentId ?? null;
  if (col === instruments.id) return j.instrument?.id ?? null;
  if (col === instruments.subjectId) return j.instrument?.subjectId ?? null;
  if (col === instruments.gradeId) return j.instrument?.gradeId ?? null;
  return undefined;
}

function project(
  projection: Record<string, unknown>,
  resolve: (col: unknown) => unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(projection)) {
    out[key] = resolve(col);
  }
  return out;
}

interface QueryChain {
  from(table: unknown): QueryChain;
  innerJoin(table: unknown, on: unknown): QueryChain;
  leftJoin(table: unknown, on: unknown): QueryChain;
  where(pred: unknown): QueryChain;
  orderBy(...cols: unknown[]): QueryChain;
  limit(n: number): QueryChain;
  then(onFulfilled: (rows: unknown[]) => unknown): Promise<unknown>;
}

function makeDb(store: Store): Database {
  const select = (projection: Record<string, unknown>): QueryChain => {
    let baseTable: unknown;
    let wherePred: unknown;
    let limitN: number | undefined;

    const run = (): unknown[] => {
      if (baseTable === taxonomyNodes) {
        const matched = store.nodes.filter((n) =>
          evalPred(wherePred, (c) => resolveForNode(c, n)),
        );
        const limited = limitN !== undefined ? matched.slice(0, limitN) : matched;
        return limited.map((n) => project(projection, (c) => resolveForNode(c, n)));
      }

      // Query de ítems: item_taxonomy_tags ⨝ items ⨝ instruments.
      const joined: JoinedRow[] = store.tags
        .map((tag): JoinedRow | null => {
          const item = store.items.find((it) => it.id === tag.itemId);
          if (!item) return null; // innerJoin
          const instrument = store.instruments.find((ins) => ins.id === item.instrumentId) ?? null;
          return { tag, item, instrument };
        })
        .filter((j): j is JoinedRow => j !== null)
        .filter((j) => evalPred(wherePred, (c) => resolveForItem(c, j)));

      joined.sort((a, b) => a.item.position - b.item.position); // orderBy items.position
      const limited = limitN !== undefined ? joined.slice(0, limitN) : joined;
      return limited.map((j) => project(projection, (c) => resolveForItem(c, j)));
    };

    const chain: QueryChain = {
      from: (t) => {
        baseTable = t;
        return chain;
      },
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: (p) => {
        wherePred = p;
        return chain;
      },
      orderBy: () => chain,
      limit: (n) => {
        limitN = n;
        return chain;
      },
      then: (onFulfilled) => Promise.resolve(run()).then(onFulfilled),
    };
    return chain;
  };

  return { select } as unknown as Database;
}

// ── Builders de filas ────────────────────────────────────────────────────────

function node(partial: Partial<NodeRow> & { id: string }): NodeRow {
  return {
    code: null,
    name: 'Nodo',
    description: null,
    type: 'learning_objective',
    parentId: null,
    subjectId: null,
    gradeId: null,
    order: 0,
    ...partial,
  };
}

function item(partial: Partial<ItemRow> & { id: string }): ItemRow {
  return {
    position: 0,
    type: 'multiple_choice',
    content: {},
    status: 'published',
    deletedAt: null,
    orgId: null,
    instrumentId: null,
    ...partial,
  };
}

function tag(itemId: string, nodeId: string): TagRow {
  return { itemId, nodeId };
}

function instrument(partial: Partial<InstrumentRow> & { id: string }): InstrumentRow {
  return { subjectId: null, gradeId: null, ...partial };
}

function emptyStore(partial: Partial<Store> = {}): Store {
  return { nodes: [], items: [], tags: [], instruments: [], ...partial };
}

function makeRetriever(store: Store): StructuredCurriculumRetriever {
  return new StructuredCurriculumRetriever(makeDb(store));
}

const leaf = node({ id: 'leaf', code: 'OA-01', name: 'Comprender textos', description: 'Desc', parentId: 'axis' });

describe('StructuredCurriculumRetriever', () => {
  // ── Estructura del árbol ─────────────────────────────────────────────────

  it('lanza NotFoundException si el nodo no existe', async () => {
    const retriever = makeRetriever(emptyStore());
    await expect(retriever.getContext('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('devuelve el nodo mapeado a TaxonomyNodeRef (sin parentId/subjectId/gradeId)', async () => {
    const retriever = makeRetriever(
      emptyStore({ nodes: [leaf, node({ id: 'axis', name: 'Eje', code: 'EJE' })] }),
    );
    const ctx = await retriever.getContext('leaf');
    expect(ctx.node).toEqual({
      id: 'leaf',
      code: 'OA-01',
      name: 'Comprender textos',
      description: 'Desc',
      type: 'learning_objective',
    });
    expect(ctx.node).not.toHaveProperty('parentId');
    expect(ctx.node).not.toHaveProperty('subjectId');
  });

  it('devuelve los ancestros ordenados de raíz a padre', async () => {
    const retriever = makeRetriever(
      emptyStore({
        nodes: [
          leaf,
          node({ id: 'axis', name: 'Eje', type: 'axis', parentId: 'root' }),
          node({ id: 'root', name: 'Raíz', type: 'domain', parentId: null }),
        ],
      }),
    );
    const ctx = await retriever.getContext('leaf');
    expect(ctx.ancestors.map((a) => a.id)).toEqual(['root', 'axis']);
  });

  it('devuelve descriptores (hijos directos) y hermanos (mismo parentId, sin el propio)', async () => {
    const retriever = makeRetriever(
      emptyStore({
        nodes: [
          leaf,
          node({ id: 'axis', name: 'Eje', parentId: null }),
          node({ id: 'c1', name: 'Descriptor', type: 'descriptor', parentId: 'leaf' }),
          node({ id: 'sib', name: 'Hermano', parentId: 'axis' }),
        ],
      }),
    );
    const ctx = await retriever.getContext('leaf');
    expect(ctx.descriptors.map((d) => d.id)).toEqual(['c1']);
    expect(ctx.siblings.map((s) => s.id)).toEqual(['sib']);
  });

  it('para un nodo raíz devuelve ancestros/hermanos/descriptores/ítems vacíos', async () => {
    const retriever = makeRetriever(
      emptyStore({ nodes: [node({ id: 'root', name: 'Raíz', type: 'domain', parentId: null })] }),
    );
    const ctx = await retriever.getContext('root');
    expect(ctx.ancestors).toEqual([]);
    expect(ctx.siblings).toEqual([]);
    expect(ctx.descriptors).toEqual([]);
    expect(ctx.taggedItems).toEqual([]);
  });

  it('no entra en bucle infinito si los parentId forman un ciclo', async () => {
    const retriever = makeRetriever(
      emptyStore({
        nodes: [
          node({ id: 'leaf', parentId: 'a' }),
          node({ id: 'a', name: 'A', type: 'axis', parentId: 'b' }),
          node({ id: 'b', name: 'B', type: 'axis', parentId: 'a' }),
        ],
      }),
    );
    const ctx = await retriever.getContext('leaf');
    // sube a 'a' (parent b), luego 'b' (parent a → ya visitado, corta) → [b, a].
    expect(ctx.ancestors.map((x) => x.id)).toEqual(['b', 'a']);
  });

  // ── G5: extracción enriquecida del contenido ─────────────────────────────

  it('extrae stem + alternativas + clave + explicación de forma defensiva por tipo', async () => {
    const retriever = makeRetriever(
      emptyStore({
        nodes: [leaf, node({ id: 'axis', name: 'Eje', parentId: null })],
        items: [
          item({
            id: 'mc',
            position: 1,
            type: 'multiple_choice',
            content: {
              stem: '¿Idea principal?',
              alternatives: [
                { key: 'A', text: 'Uno', isCorrect: false },
                { key: 'B', text: 'Dos', isCorrect: true },
              ],
              explanation: 'La B es correcta',
            },
          }),
          item({ id: 'oe', position: 2, type: 'open_ended', content: { prompt: 'Explica' } }),
          item({ id: 'bad', position: 3, type: 'multiple_choice', content: { stem: 42 } }),
        ],
        tags: [tag('mc', 'leaf'), tag('oe', 'leaf'), tag('bad', 'leaf')],
      }),
    );

    const ctx = await retriever.getContext('leaf');
    const byId = Object.fromEntries(ctx.taggedItems.map((i) => [i.itemId, i]));

    expect(byId.mc).toMatchObject({
      stem: '¿Idea principal?',
      correctKey: 'B',
      explanation: 'La B es correcta',
      fromNode: 'target',
    });
    expect(byId.mc!.alternatives).toEqual([
      { key: 'A', text: 'Uno', isCorrect: false },
      { key: 'B', text: 'Dos', isCorrect: true },
    ]);
    // Tipo sin alternativas → null (degradación elegante), stem del prompt no aplica.
    expect(byId.oe).toMatchObject({ stem: null, alternatives: null, correctKey: null });
    // stem no-string → null.
    expect(byId.bad!.stem).toBeNull();
  });

  it('excluye ítems no publicados y soft-deleted', async () => {
    const retriever = makeRetriever(
      emptyStore({
        nodes: [leaf, node({ id: 'axis', name: 'Eje', parentId: null })],
        items: [
          item({ id: 'ok', position: 1, content: { stem: 'ok' } }),
          item({ id: 'draft', position: 2, status: 'draft', content: { stem: 'draft' } }),
          item({ id: 'deleted', position: 3, deletedAt: new Date(), content: { stem: 'del' } }),
        ],
        tags: [tag('ok', 'leaf'), tag('draft', 'leaf'), tag('deleted', 'leaf')],
      }),
    );
    const ctx = await retriever.getContext('leaf');
    expect(ctx.taggedItems.map((i) => i.itemId)).toEqual(['ok']);
  });

  // ── G5: filtro por asignatura / nivel ────────────────────────────────────

  it('filtra el pool por asignatura/nivel del nodo objetivo (vía instrumento, COALESCE)', async () => {
    const retriever = makeRetriever(
      emptyStore({
        nodes: [
          node({ id: 'leaf', parentId: 'axis', subjectId: 'S', gradeId: 'G' }),
          node({ id: 'axis', name: 'Eje', parentId: null }),
        ],
        instruments: [
          instrument({ id: 'insMatch', subjectId: 'S', gradeId: 'G' }),
          instrument({ id: 'insOtherSubj', subjectId: 'X', gradeId: 'G' }),
          instrument({ id: 'insOtherGrade', subjectId: 'S', gradeId: 'Y' }),
        ],
        items: [
          item({ id: 'match1', position: 1, instrumentId: 'insMatch', content: { stem: 'a' } }),
          item({ id: 'match2', position: 2, instrumentId: 'insMatch', content: { stem: 'b' } }),
          item({ id: 'noInstrument', position: 3, instrumentId: null, content: { stem: 'c' } }),
          item({ id: 'otherSubj', position: 4, instrumentId: 'insOtherSubj', content: { stem: 'd' } }),
          item({ id: 'otherGrade', position: 5, instrumentId: 'insOtherGrade', content: { stem: 'e' } }),
        ],
        tags: [
          tag('match1', 'leaf'),
          tag('match2', 'leaf'),
          tag('noInstrument', 'leaf'),
          tag('otherSubj', 'leaf'),
          tag('otherGrade', 'leaf'),
        ],
      }),
    );
    const ctx = await retriever.getContext('leaf');
    const ids = ctx.taggedItems.map((i) => i.itemId);
    // Mismo subject+grade, o sin instrumento (subject/grade null → aceptado por COALESCE).
    expect(ids).toEqual(['match1', 'match2', 'noInstrument']);
    expect(ids).not.toContain('otherSubj');
    expect(ids).not.toContain('otherGrade');
  });

  it('omite el filtro de asignatura/nivel si el nodo objetivo no los define', async () => {
    const retriever = makeRetriever(
      emptyStore({
        nodes: [leaf, node({ id: 'axis', name: 'Eje', parentId: null })],
        instruments: [instrument({ id: 'ins', subjectId: 'CUALQUIERA', gradeId: 'OTRO' })],
        items: [item({ id: 'x', position: 1, instrumentId: 'ins', content: { stem: 'x' } })],
        tags: [tag('x', 'leaf')],
      }),
    );
    const ctx = await retriever.getContext('leaf');
    expect(ctx.taggedItems.map((i) => i.itemId)).toEqual(['x']);
  });

  // ── G5: filtro por org (banco propio ∪ oficial) ──────────────────────────

  it('con orgId incluye banco propio + oficial (org_id IS NULL) y excluye otra org', async () => {
    const store = emptyStore({
      nodes: [leaf, node({ id: 'axis', name: 'Eje', parentId: null })],
      items: [
        item({ id: 'own', position: 1, orgId: 'org-1', content: { stem: 'own' } }),
        item({ id: 'official', position: 2, orgId: null, content: { stem: 'official' } }),
        item({ id: 'other', position: 3, orgId: 'org-2', content: { stem: 'other' } }),
      ],
      tags: [tag('own', 'leaf'), tag('official', 'leaf'), tag('other', 'leaf')],
    });

    const withOrg = await makeRetriever(store).getContext('leaf', 'org-1');
    const orgIds = withOrg.taggedItems.map((i) => i.itemId);
    expect(orgIds).toContain('own');
    expect(orgIds).toContain('official');
    expect(orgIds).not.toContain('other');

    // Sin orgId → pool completo (comportamiento previo): aparece 'other'.
    const noOrg = await makeRetriever(store).getContext('leaf');
    expect(noOrg.taggedItems.map((i) => i.itemId)).toContain('other');
  });

  // ── G5: fallback en el árbol ─────────────────────────────────────────────

  it('hace fallback a hermano y luego ancestro cuando el nodo tiene pocos ítems propios', async () => {
    const retriever = makeRetriever(
      emptyStore({
        nodes: [
          node({ id: 'leaf', parentId: 'axis' }),
          node({ id: 'axis', name: 'Eje', type: 'axis', parentId: 'root' }),
          node({ id: 'root', name: 'Raíz', type: 'domain', parentId: null }),
          node({ id: 'sib', name: 'Hermano', parentId: 'axis' }),
        ],
        items: [
          item({ id: 't1', position: 1, content: { stem: 'target' } }),
          item({ id: 's1', position: 2, content: { stem: 'sibling' } }),
          item({ id: 'a1', position: 3, content: { stem: 'ancestor' } }),
        ],
        // 't1' etiquetado a leaf Y a sib → debe deduplicarse como 'target'.
        tags: [tag('t1', 'leaf'), tag('t1', 'sib'), tag('s1', 'sib'), tag('a1', 'axis')],
      }),
    );

    const ctx = await retriever.getContext('leaf');
    const provenance = ctx.taggedItems.map((i) => ({ id: i.itemId, from: i.fromNode }));
    expect(provenance).toEqual([
      { id: 't1', from: 'target' },
      { id: 's1', from: 'sibling' },
      { id: 'a1', from: 'ancestor' },
    ]);
  });

  it('NO hace fallback cuando el nodo objetivo ya tiene suficientes ítems propios', async () => {
    const retriever = makeRetriever(
      emptyStore({
        nodes: [
          node({ id: 'leaf', parentId: 'axis' }),
          node({ id: 'axis', name: 'Eje', parentId: null }),
          node({ id: 'sib', name: 'Hermano', parentId: 'axis' }),
        ],
        items: [
          item({ id: 't1', position: 1, content: { stem: '1' } }),
          item({ id: 't2', position: 2, content: { stem: '2' } }),
          item({ id: 't3', position: 3, content: { stem: '3' } }),
          item({ id: 's1', position: 4, content: { stem: 'sib' } }),
        ],
        tags: [tag('t1', 'leaf'), tag('t2', 'leaf'), tag('t3', 'leaf'), tag('s1', 'sib')],
      }),
    );
    const ctx = await retriever.getContext('leaf');
    const ids = ctx.taggedItems.map((i) => i.itemId);
    expect(ids).toEqual(['t1', 't2', 't3']);
    expect(ids).not.toContain('s1');
    expect(ctx.taggedItems.every((i) => i.fromNode === 'target')).toBe(true);
  });

  it('acota el total de ítems de referencia a MAX_TAGGED_ITEMS (10)', async () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      item({ id: `i${i}`, position: i, content: { stem: `q${i}` } }),
    );
    const retriever = makeRetriever(
      emptyStore({
        nodes: [leaf, node({ id: 'axis', name: 'Eje', parentId: null })],
        items: many,
        tags: many.map((it) => tag(it.id, 'leaf')),
      }),
    );
    const ctx = await retriever.getContext('leaf');
    expect(ctx.taggedItems).toHaveLength(10);
  });
});
