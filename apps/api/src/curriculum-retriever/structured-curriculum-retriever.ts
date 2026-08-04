import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull, ne, or, type SQL } from 'drizzle-orm';
import { instruments, items, itemTaxonomyTags, taxonomyNodes } from '@soe/db';
import type {
  TaggedItemAlternative,
  TaggedItemRef,
  TaxonomyNodeRef,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import {
  CurriculumRetriever,
  type CurriculumContextWithProvenance,
  type ReferenceItemProvenance,
  type ReferenceItemRef,
} from './curriculum-retriever';

/** Máximo de ítems de referencia que se devuelven (target + fallback). */
const MAX_TAGGED_ITEMS = 10;

/**
 * Umbral por debajo del cual el nodo objetivo se considera "pobre" en ítems propios
 * y se activa el fallback a hermanos/ancestros (G5 remedial).
 */
const MIN_REFERENCE_ITEMS = 3;

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
 * El aislamiento por org se aplica con un filtro `org_id` EXPLÍCITO en el WHERE.
 *
 * No hardcodea ningún currículo ("DIA"/"Lenguaje"): opera solo por taxonomía.
 */
@Injectable()
export class StructuredCurriculumRetriever implements CurriculumRetriever {
  constructor(@InjectDb() private readonly db: Database) {}

  async getContext(
    nodeId: string,
    orgId?: string,
  ): Promise<CurriculumContextWithProvenance> {
    const node = await this.findNode(nodeId);
    if (!node) {
      throw new NotFoundException(`Taxonomy node ${nodeId} not found`);
    }

    const [ancestors, descriptors, siblings, targetItems] = await Promise.all([
      this.loadAncestors(node.parentId),
      this.loadDescriptors(node.id),
      this.loadSiblings(node.id, node.parentId),
      this.loadTaggedItemsForNodes([node.id], node, orgId),
    ]);

    const taggedItems = await this.assembleReferenceItems(
      node,
      targetItems,
      siblings,
      ancestors,
      orgId,
    );

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
   * Arma la lista final de ítems de referencia. Parte de los ítems propios del
   * nodo objetivo (`target`); si tiene menos de `MIN_REFERENCE_ITEMS`, completa
   * con ítems de nodos hermano y luego ancestros (misma asignatura/nivel, mismo
   * pool visible por org), deduplicando por `itemId` y hasta `MAX_TAGGED_ITEMS`.
   * Cada ítem queda marcado con su procedencia en el árbol.
   */
  private async assembleReferenceItems(
    node: TaxonomyNodeRow,
    targetItems: TaggedItemRef[],
    siblings: TaxonomyNodeRef[],
    ancestors: TaxonomyNodeRef[],
    orgId?: string,
  ): Promise<ReferenceItemRef[]> {
    const result: ReferenceItemRef[] = [];
    const seen = new Set<string>();

    const collect = (candidates: TaggedItemRef[], from: ReferenceItemProvenance): void => {
      for (const item of candidates) {
        if (result.length >= MAX_TAGGED_ITEMS) break;
        if (seen.has(item.itemId)) continue;
        seen.add(item.itemId);
        result.push({ ...item, fromNode: from });
      }
    };

    collect(targetItems, 'target');

    // Fallback: el nodo objetivo tiene pocos ítems propios → completar con
    // hermanos y, si aún falta, con ancestros (referencia secundaria).
    if (targetItems.length < MIN_REFERENCE_ITEMS) {
      if (result.length < MAX_TAGGED_ITEMS && siblings.length > 0) {
        const siblingItems = await this.loadTaggedItemsForNodes(
          siblings.map((s) => s.id),
          node,
          orgId,
        );
        collect(siblingItems, 'sibling');
      }
      if (result.length < MAX_TAGGED_ITEMS && ancestors.length > 0) {
        const ancestorItems = await this.loadTaggedItemsForNodes(
          ancestors.map((a) => a.id),
          node,
          orgId,
        );
        collect(ancestorItems, 'ancestor');
      }
    }

    return result;
  }

  /**
   * Ítems `published` etiquetados a cualquiera de `nodeIds`, enriquecidos con su
   * contenido (stem + alternativas + clave + explicación). Aplica:
   *  - pool visible por org (`org_id = :orgId ∪ org_id IS NULL`) cuando llega `orgId`;
   *  - filtro por asignatura/nivel del nodo objetivo vía el instrumento del ítem.
   * Ignora ítems soft-deleted. Limita a `MAX_TAGGED_ITEMS`.
   */
  private async loadTaggedItemsForNodes(
    nodeIds: string[],
    targetNode: TaxonomyNodeRow,
    orgId?: string,
  ): Promise<TaggedItemRef[]> {
    if (nodeIds.length === 0) return [];

    const conditions: (SQL | undefined)[] = [
      inArray(itemTaxonomyTags.nodeId, nodeIds),
      isNull(items.deletedAt),
      eq(items.status, 'published'),
    ];

    // Pool visible por org: banco oficial (org_id IS NULL) ∪ banco propio de la org.
    // Estas tablas NO están bajo RLS → el filtro va explícito (CLAUDE.md §5.2).
    if (orgId) {
      conditions.push(or(eq(items.orgId, orgId), isNull(items.orgId)));
    }

    // Filtro asignatura/nivel: el pool debe compartir la asignatura/nivel del nodo
    // objetivo. Los ítems no la llevan directa → se toma del instrumento; un ítem
    // sin asignatura/nivel conocidos (instrumento null o sin subject/grade) se
    // acepta (no se excluye). Equivale a COALESCE(instruments.subjectId, <nodo>) =
    // <nodo>. Si el nodo objetivo no define asignatura/nivel, se omite el filtro
    // (no excluir todo el banco).
    if (targetNode.subjectId) {
      conditions.push(
        or(eq(instruments.subjectId, targetNode.subjectId), isNull(instruments.subjectId)),
      );
    }
    if (targetNode.gradeId) {
      conditions.push(
        or(eq(instruments.gradeId, targetNode.gradeId), isNull(instruments.gradeId)),
      );
    }

    const rows = await this.db
      .select({
        itemId: items.id,
        position: items.position,
        type: items.type,
        content: items.content,
        subjectId: instruments.subjectId,
        gradeId: instruments.gradeId,
      })
      .from(itemTaxonomyTags)
      .innerJoin(items, eq(itemTaxonomyTags.itemId, items.id))
      .leftJoin(instruments, eq(items.instrumentId, instruments.id))
      .where(and(...conditions))
      .orderBy(items.position)
      .limit(MAX_TAGGED_ITEMS);

    return rows.map((row) => toTaggedItemRef(row, targetNode));
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
  subjectId: taxonomyNodes.subjectId,
  gradeId: taxonomyNodes.gradeId,
} as const;

type TaxonomyNodeRow = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  type: string;
  parentId: string | null;
  subjectId: string | null;
  gradeId: string | null;
};

/** Fila cruda de la query de ítems etiquetados (con asignatura/nivel del instrumento). */
type TaggedItemRow = {
  itemId: string;
  position: number;
  type: string;
  content: unknown;
  subjectId: string | null;
  gradeId: string | null;
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

/** Mapea una fila de ítem a `TaggedItemRef`, extrayendo su contenido de referencia. */
function toTaggedItemRef(row: TaggedItemRow, targetNode: TaxonomyNodeRow): TaggedItemRef {
  const alternatives = extractAlternatives(row.content);
  return {
    itemId: row.itemId,
    position: row.position,
    type: row.type,
    stem: extractStem(row.content),
    alternatives,
    correctKey: extractCorrectKey(alternatives),
    explanation: extractExplanation(row.content),
    difficulty: null, // p empírico no disponible en Ola 1
    subjectId: row.subjectId ?? targetNode.subjectId ?? null,
    gradeId: row.gradeId ?? targetNode.gradeId ?? null,
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

/**
 * Extrae `content.alternatives` como lista `{key,text,isCorrect}` de forma
 * defensiva (mismo criterio que `extractStem`). Solo los tipos con alternativas
 * (`multiple_choice`, `listening`) las traen; el resto degrada a `null`. El banco
 * puede tener contenido heterogéneo, por eso se parsea campo a campo en lugar de
 * validar contra el schema estricto (que rechazaría un ítem entero por un detalle).
 */
function extractAlternatives(content: unknown): TaggedItemAlternative[] | null {
  if (!content || typeof content !== 'object' || !('alternatives' in content)) {
    return null;
  }
  const raw = (content as { alternatives?: unknown }).alternatives;
  if (!Array.isArray(raw)) return null;

  const parsed: TaggedItemAlternative[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { key, text, isCorrect } = entry as {
      key?: unknown;
      text?: unknown;
      isCorrect?: unknown;
    };
    if (typeof key === 'string' && typeof text === 'string' && typeof isCorrect === 'boolean') {
      parsed.push({ key, text, isCorrect });
    }
  }
  return parsed.length > 0 ? parsed : null;
}

/** Clave correcta: primera alternativa con `isCorrect=true`. `null` si no aplica. */
function extractCorrectKey(alternatives: TaggedItemAlternative[] | null): string | null {
  if (!alternatives) return null;
  const correct = alternatives.find((alt) => alt.isCorrect);
  return correct ? correct.key : null;
}

/** Explicación/justificación del ítem, si el `content` la trae como string. */
function extractExplanation(content: unknown): string | null {
  if (content && typeof content === 'object' && 'explanation' in content) {
    const explanation = (content as { explanation?: unknown }).explanation;
    if (typeof explanation === 'string') return explanation;
  }
  return null;
}
