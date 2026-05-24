import { buildTree } from './tree-builder';
import type { TaxonomyNode } from '@soe/db';

function node(over: Partial<TaxonomyNode> & { id: string }): TaxonomyNode {
  return {
    id: over.id,
    curriculumId: 'c1',
    parentId: over.parentId ?? null,
    type: over.type ?? 'domain',
    code: over.code ?? null,
    name: over.name ?? `Node ${over.id}`,
    description: over.description ?? null,
    gradeId: over.gradeId ?? null,
    subjectId: over.subjectId ?? null,
    order: over.order ?? 0,
    depth: over.depth ?? 0,
    metadata: over.metadata ?? {},
    createdAt: over.createdAt ?? new Date(),
  } as TaxonomyNode;
}

describe('buildTree', () => {
  it('arma un árbol con raíces y descendientes ordenados por order', () => {
    const nodes = [
      node({ id: 'b', parentId: null, order: 1 }),
      node({ id: 'a', parentId: null, order: 0 }),
      node({ id: 'a1', parentId: 'a', order: 1 }),
      node({ id: 'a0', parentId: 'a', order: 0 }),
    ];
    const tree = buildTree(nodes);
    expect(tree.map((n) => n.id)).toEqual(['a', 'b']);
    expect(tree[0].children.map((n) => n.id)).toEqual(['a0', 'a1']);
  });

  it('trata como raíz a nodos con parentId que no existe en la lista', () => {
    const nodes = [node({ id: 'a', parentId: 'missing' }), node({ id: 'b', parentId: null })];
    const tree = buildTree(nodes);
    expect(tree.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  it('soporta lista vacía', () => {
    expect(buildTree([])).toEqual([]);
  });
});
