// Tipos de retorno del CurriculumRetriever (F2 S0 — H19.21). Recuperación
// curricular estructurada sobre taxonomy_nodes (sin embeddings).

export type TaxonomyNodeRef = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  type: string; // 'learning_objective' | 'axis' | 'descriptor' | …
};

/** Alternativa de un ítem de referencia (multiple_choice). */
export type TaggedItemAlternative = { key: string; text: string; isCorrect: boolean };

export type TaggedItemRef = {
  itemId: string;
  position: number | null;
  type: string; // item_type
  stem: string | null; // extraído de items.content para few-shot
  // NUEVO (opcional; poblado por el retriever enriquecido — Ola 1 remedial G5):
  alternatives?: TaggedItemAlternative[] | null; // para multiple_choice
  correctKey?: string | null; // clave correcta, si aplica
  explanation?: string | null; // explicación/justificación
  difficulty?: number | null; // p empírico si está disponible (null en Ola 1)
  subjectId?: string | null; // para trazar el filtro asignatura/nivel
  gradeId?: string | null;
};

export type CurriculumContext = {
  node: TaxonomyNodeRef;
  ancestors: TaxonomyNodeRef[]; // de raíz → padre (eje, dominio)
  descriptors: TaxonomyNodeRef[]; // hijos directos
  siblings: TaxonomyNodeRef[]; // mismo parent_id
  taggedItems: TaggedItemRef[]; // ítems etiquetados a este nodo
};
