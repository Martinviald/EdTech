import type { CurriculumContext } from '@soe/types';

/**
 * Puerto de recuperación curricular estructurada (F2 S0 — H19.21).
 *
 * La implementación de F2 recorre `taxonomy_nodes` (nodo + ancestros + descriptores
 * + hermanos) y los ítems etiquetados, SIN embeddings. El puerto permite añadir una
 * implementación vectorial (pgvector) de forma aditiva si un gatillo lo justifica.
 */
export interface CurriculumRetriever {
  getContext(nodeId: string): Promise<CurriculumContext>;
}

/** Token de inyección NestJS para el puerto CurriculumRetriever. */
export const CURRICULUM_RETRIEVER = 'CURRICULUM_RETRIEVER';
