// Tipos de retorno del CurriculumRetriever (F2 S0 — H19.21). Recuperación
// curricular estructurada sobre taxonomy_nodes (sin embeddings).

export type TaxonomyNodeRef = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  type: string; // 'learning_objective' | 'axis' | 'descriptor' | …
};

export type TaggedItemRef = {
  itemId: string;
  position: number | null;
  type: string; // item_type
  stem: string | null; // extraído de items.content para few-shot
};

export type CurriculumContext = {
  node: TaxonomyNodeRef;
  ancestors: TaxonomyNodeRef[]; // de raíz → padre (eje, dominio)
  descriptors: TaxonomyNodeRef[]; // hijos directos
  siblings: TaxonomyNodeRef[]; // mismo parent_id
  taggedItems: TaggedItemRef[]; // ítems etiquetados a este nodo
};
