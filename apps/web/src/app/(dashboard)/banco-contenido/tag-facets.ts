// TKT-12 / TKT-14 — Facetas de tags para el filtro multi-tag (lógica OR).
//
// Deriva el universo de nodos de taxonomía "presentes en los datos" (los tags
// que efectivamente etiquetan los ítems cargados), tal como decidió TKT-12:
// el filtro opera sobre los tags ya presentes, no sobre un catálogo aparte.
// Se comparte entre la tabla de ítems de un instrumento (TKT-12) y el banco de
// ítems global (TKT-14) para no duplicar la lógica de facetas.

import type { ItemTaxonomyTagModel } from '@soe/types';
import { formatNodeCode } from '@/lib/taxonomy-labels';

/** Una faceta seleccionable del filtro: un nodo de taxonomía con su conteo. */
export type TagFacet = {
  nodeId: string;
  label: string;
  /** Tipo del nodo (`skill`, `learning_objective`, `text_type`, …) para agrupar. */
  type: string;
  /** Cuántos ítems del set actual llevan este nodo. */
  count: number;
};

/** Etiqueta legible de un nodo para el filtro (código legible + nombre humano). */
export function facetLabel(node: ItemTaxonomyTagModel['node'], nodeId: string): string {
  if (!node) return nodeId.slice(0, 8);
  const short = formatNodeCode(node.code, node.type);
  if (short && node.name) return `${short} · ${node.name}`;
  return node.name ?? short ?? node.code ?? nodeId.slice(0, 8);
}

/**
 * Deriva las facetas (nodos únicos con conteo) desde los ítems cargados.
 * Ordena por tipo de nodo y luego por etiqueta para una lista estable.
 */
export function deriveTagFacets(
  items: ReadonlyArray<{ tags?: ItemTaxonomyTagModel[] }>,
): TagFacet[] {
  const byNode = new Map<string, TagFacet>();
  for (const item of items) {
    for (const tag of item.tags ?? []) {
      const existing = byNode.get(tag.nodeId);
      if (existing) {
        existing.count += 1;
        continue;
      }
      byNode.set(tag.nodeId, {
        nodeId: tag.nodeId,
        label: facetLabel(tag.node, tag.nodeId),
        type: tag.node?.type ?? 'unknown',
        count: 1,
      });
    }
  }
  return [...byNode.values()].sort((a, b) =>
    a.type === b.type ? a.label.localeCompare(b.label) : a.type.localeCompare(b.type),
  );
}

/**
 * Filtra ítems por nodos seleccionados con lógica OR: un ítem pasa si tiene
 * CUALQUIERA de los nodos seleccionados. Si no hay selección, devuelve todo.
 */
export function filterItemsByTags<T extends { tags?: ItemTaxonomyTagModel[] }>(
  items: readonly T[],
  selectedNodeIds: readonly string[],
): T[] {
  if (selectedNodeIds.length === 0) return [...items];
  const selected = new Set(selectedNodeIds);
  return items.filter((item) => (item.tags ?? []).some((t) => selected.has(t.nodeId)));
}
