import type { CurriculumContext, TaggedItemRef } from '@soe/types';

/** Procedencia de un ítem de referencia dentro del árbol de taxonomía (G5 remedial). */
export type ReferenceItemProvenance = 'target' | 'sibling' | 'ancestor';

/**
 * Ítem de referencia enriquecido con su procedencia en el árbol. Extiende el
 * `TaggedItemRef` compartido (sigue siendo asignable a `TaggedItemRef`), por lo que
 * un `CurriculumContextWithProvenance` es asignable a `CurriculumContext` y no
 * rompe a los consumidores que sólo esperan el contexto base.
 */
export interface ReferenceItemRef extends TaggedItemRef {
  fromNode: ReferenceItemProvenance;
}

/** `CurriculumContext` cuyos `taggedItems` llevan la marca de procedencia. */
export interface CurriculumContextWithProvenance extends Omit<CurriculumContext, 'taggedItems'> {
  taggedItems: ReferenceItemRef[];
}

/**
 * Puerto de recuperación curricular estructurada (F2 S0 — H19.21).
 *
 * La implementación de F2 recorre `taxonomy_nodes` (nodo + ancestros + descriptores
 * + hermanos) y los ítems etiquetados, SIN embeddings. El puerto permite añadir una
 * implementación vectorial (pgvector) de forma aditiva si un gatillo lo justifica.
 */
export interface CurriculumRetriever {
  /**
   * Recupera el contexto curricular de un nodo. `orgId` (opcional) restringe el
   * pool de ítems al banco visible por la org (`org_id = :orgId ∪ org_id IS NULL`);
   * sin él, se usa el pool completo (comportamiento previo, aditivo).
   */
  getContext(nodeId: string, orgId?: string): Promise<CurriculumContextWithProvenance>;
}

/** Token de inyección NestJS para el puerto CurriculumRetriever. */
export const CURRICULUM_RETRIEVER = 'CURRICULUM_RETRIEVER';
