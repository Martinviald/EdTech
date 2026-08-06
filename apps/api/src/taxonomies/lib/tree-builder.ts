import type { TaxonomyNode } from '@soe/db';

export type TreeInput = { id: string; parentId: string | null; order: number };

export type TreeOf<T> = T & { children: TreeOf<T>[] };

export type TaxonomyTreeNode = TreeOf<TaxonomyNode>;

/**
 * Convierte una lista plana de nodos en un árbol jerárquico usando `parentId`.
 * Un nodo cuyo `parentId` no está en la lista se trata como raíz: así un subárbol
 * parcial (p. ej. sólo los nodos que un alumno tiene evaluados) se puede armar sin
 * cargar sus ancestros.
 */
export function buildTree<T extends TreeInput>(nodes: readonly T[]): TreeOf<T>[] {
  const map = new Map<string, TreeOf<T>>();
  for (const node of nodes) {
    map.set(node.id, { ...node, children: [] });
  }

  const roots: TreeOf<T>[] = [];
  for (const node of map.values()) {
    const parent = node.parentId === null ? undefined : map.get(node.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortByOrder = (a: TreeOf<T>, b: TreeOf<T>) => a.order - b.order;
  roots.sort(sortByOrder);
  for (const node of map.values()) {
    node.children.sort(sortByOrder);
  }

  return roots;
}
