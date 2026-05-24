import type { TaxonomyNode } from '@soe/db';

export type TaxonomyTreeNode = TaxonomyNode & {
  children: TaxonomyTreeNode[];
};

/**
 * Convierte una lista plana de nodos en un árbol jerárquico usando `parentId`.
 * Los nodos raíz (parentId === null) quedan en el array de retorno.
 * Los nodos cuyo `parentId` no existe en la lista quedan huérfanos y NO se incluyen.
 */
export function buildTree(nodes: TaxonomyNode[]): TaxonomyTreeNode[] {
  const map = new Map<string, TaxonomyTreeNode>();
  for (const node of nodes) {
    map.set(node.id, { ...node, children: [] });
  }

  const roots: TaxonomyTreeNode[] = [];
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortByOrder = (a: TaxonomyTreeNode, b: TaxonomyTreeNode) => a.order - b.order;
  roots.sort(sortByOrder);
  for (const node of map.values()) {
    node.children.sort(sortByOrder);
  }

  return roots;
}
