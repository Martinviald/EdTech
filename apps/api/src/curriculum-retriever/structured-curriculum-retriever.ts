import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { items, itemTaxonomyTags, taxonomyNodes } from '@soe/db';
import type { CurriculumContext, TaggedItemRef, TaxonomyNodeRef } from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import { CurriculumRetriever } from './curriculum-retriever';

/** Máximo de ítems etiquetados que se devuelven para few-shot. */
const MAX_TAGGED_ITEMS = 10;

/** Tope defensivo de profundidad al subir por parentId (evita ciclos accidentales). */
const MAX_ANCESTOR_DEPTH = 64;

/**
 * Recuperación curricular estructurada (H19.21) sobre `taxonomy_nodes` — sin
 * embeddings. Recorre el árbol polimórfico de la taxonomía: nodo + ancestros
 * (raíz → padre) + descriptores (hijos directos) + hermanos (mismo parentId) y
 * los ítems etiquetados vía `item_taxonomy_tags`.
 *
 * `taxonomy_nodes`, `items` e `item_taxonomy_tags` NO están bajo RLS, por lo que
 * las queries corren directas sobre `this.db` sin `withOrgContext` (CLAUDE.md §5.2).
 *
 * No hardcodea ningún currículo ("DIA"/"Lenguaje"): opera solo por taxonomía.
 */
@Injectable()
export class StructuredCurriculumRetriever implements CurriculumRetriever {
  constructor(@InjectDb() private readonly db: Database) {}

  async getContext(nodeId: string): Promise<CurriculumContext> {
    const node = await this.findNode(nodeId);
    if (!node) {
      throw new NotFoundException(`Taxonomy node ${nodeId} not found`);
    }

    const [ancestors, descriptors, siblings, taggedItems] = await Promise.all([
      this.loadAncestors(node.parentId),
      this.loadDescriptors(node.id),
      this.loadSiblings(node.id, node.parentId),
      this.loadTaggedItems(node.id),
    ]);

    return {
      node: toNodeRef(node),
      ancestors,
      descriptors,
      siblings,
      taggedItems,
    };
  }

  /** Busca un nodo por id. `null` si no existe. */
  private async findNode(nodeId: string): Promise<TaxonomyNodeRow | null> {
    const rows = await this.db
      .select(NODE_COLUMNS)
      .from(taxonomyNodes)
      .where(eq(taxonomyNodes.id, nodeId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Sube por `parentId` hasta la raíz (loop iterativo) y devuelve los ancestros
   * ordenados de raíz → padre.
   */
  private async loadAncestors(parentId: string | null): Promise<TaxonomyNodeRef[]> {
    const chain: TaxonomyNodeRow[] = [];
    let currentParentId = parentId;
    const visited = new Set<string>();

    while (currentParentId && chain.length < MAX_ANCESTOR_DEPTH) {
      if (visited.has(currentParentId)) break; // guarda contra ciclos
      visited.add(currentParentId);

      const rows = await this.db
        .select(NODE_COLUMNS)
        .from(taxonomyNodes)
        .where(eq(taxonomyNodes.id, currentParentId))
        .limit(1);
      const parent = rows[0];
      if (!parent) break;

      chain.push(parent);
      currentParentId = parent.parentId;
    }

    // chain quedó de padre → raíz; invertimos para raíz → padre.
    return chain.reverse().map(toNodeRef);
  }

  /** Hijos directos del nodo (`parentId = nodeId`). */
  private async loadDescriptors(nodeId: string): Promise<TaxonomyNodeRef[]> {
    const rows = await this.db
      .select(NODE_COLUMNS)
      .from(taxonomyNodes)
      .where(eq(taxonomyNodes.parentId, nodeId))
      .orderBy(taxonomyNodes.order);
    return rows.map(toNodeRef);
  }

  /**
   * Hermanos: mismo `parentId` que el nodo, excluyendo el propio nodo. Si el
   * nodo es raíz (`parentId` null) → `[]`.
   */
  private async loadSiblings(
    nodeId: string,
    parentId: string | null,
  ): Promise<TaxonomyNodeRef[]> {
    if (!parentId) return [];
    const rows = await this.db
      .select(NODE_COLUMNS)
      .from(taxonomyNodes)
      .where(and(eq(taxonomyNodes.parentId, parentId), ne(taxonomyNodes.id, nodeId)))
      .orderBy(taxonomyNodes.order);
    return rows.map(toNodeRef);
  }

  /**
   * Ítems etiquetados a este nodo vía `item_taxonomy_tags`. Extrae `stem` desde
   * `items.content` (JSONB) si existe. Ignora ítems soft-deleted. Limita a
   * `MAX_TAGGED_ITEMS`.
   */
  private async loadTaggedItems(nodeId: string): Promise<TaggedItemRef[]> {
    const rows = await this.db
      .select({
        itemId: items.id,
        position: items.position,
        type: items.type,
        content: items.content,
      })
      .from(itemTaxonomyTags)
      .innerJoin(items, eq(itemTaxonomyTags.itemId, items.id))
      .where(and(eq(itemTaxonomyTags.nodeId, nodeId), isNull(items.deletedAt)))
      .orderBy(items.position)
      .limit(MAX_TAGGED_ITEMS);

    return rows.map((row) => ({
      itemId: row.itemId,
      position: row.position,
      type: row.type,
      stem: extractStem(row.content),
    }));
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers de mapeo / extracción
// ──────────────────────────────────────────────────────────────────────────────

const NODE_COLUMNS = {
  id: taxonomyNodes.id,
  code: taxonomyNodes.code,
  name: taxonomyNodes.name,
  description: taxonomyNodes.description,
  type: taxonomyNodes.type,
  parentId: taxonomyNodes.parentId,
} as const;

type TaxonomyNodeRow = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  type: string;
  parentId: string | null;
};

function toNodeRef(row: TaxonomyNodeRow): TaxonomyNodeRef {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    type: row.type,
  };
}

/**
 * Extrae `content.stem` de forma defensiva: el contenido es polimórfico por
 * `item_type` y no todos los shapes tienen `stem`. Devuelve `null` si no existe
 * o no es string.
 */
function extractStem(content: unknown): string | null {
  if (content && typeof content === 'object' && 'stem' in content) {
    const stem = (content as { stem?: unknown }).stem;
    if (typeof stem === 'string') return stem;
  }
  return null;
}
