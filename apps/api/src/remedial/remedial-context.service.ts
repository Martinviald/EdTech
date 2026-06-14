import { Inject, Injectable } from '@nestjs/common';
import type { CurriculumContext, TaxonomyNodeRef } from '@soe/types';
import {
  CURRICULUM_RETRIEVER,
  type CurriculumRetriever,
} from '../curriculum-retriever/curriculum-retriever';

/**
 * Few-shot máximo de ítems etiquetados que se inyectan en el prompt (acota tokens
 * y evita arrastrar todo el banco). El retriever ya limita su propio resultado.
 */
const MAX_FEW_SHOT_ITEMS = 5;

/** Nodo curricular serializado para el prompt (forma legible, sin ids internos crudos). */
export interface RemedialContextNode {
  code: string | null;
  name: string;
  description: string | null;
  type: string;
}

/** Ítem etiquetado servido como few-shot (anti-alucinación, sin PII). */
export interface RemedialFewShotItem {
  type: string;
  stem: string;
}

/**
 * Contexto curricular RAG ensamblado para los prompts remediales. NO contiene PII
 * (solo taxonomía + ítems del banco). Es el "retrieval" estructurado del RAG.
 */
export interface RemedialCurriculumContext {
  nodeId: string;
  target: RemedialContextNode; // el OA / brecha a remediar
  ancestors: RemedialContextNode[]; // raíz → padre (eje / dominio)
  descriptors: RemedialContextNode[]; // hijos directos (sub-habilidades)
  siblings: RemedialContextNode[]; // habilidades hermanas (contexto)
  fewShotItems: RemedialFewShotItem[]; // ítems reales etiquetados (referencia de estilo)
}

/**
 * Ensamblador del contexto RAG (H9.1). Inyecta el `CurriculumRetriever` (puerto
 * `CURRICULUM_RETRIEVER`, recuperación curricular estructurada sobre
 * `taxonomy_nodes`, sin embeddings) y arma un objeto curricular para los prompts:
 * OA objetivo + ancestros + descriptores + hermanos + few-shot de ítems
 * etiquetados. Anti-alucinación: el modelo trabaja sobre el OA real y ejemplos
 * reales. NUNCA incluye PII.
 */
@Injectable()
export class RemedialContextService {
  constructor(
    @Inject(CURRICULUM_RETRIEVER)
    private readonly retriever: CurriculumRetriever,
  ) {}

  /** Recupera y ensambla el contexto curricular para un `nodeId` (la brecha). */
  async assemble(nodeId: string): Promise<RemedialCurriculumContext> {
    const ctx: CurriculumContext = await this.retriever.getContext(nodeId);

    return {
      nodeId,
      target: toContextNode(ctx.node),
      ancestors: ctx.ancestors.map(toContextNode),
      descriptors: ctx.descriptors.map(toContextNode),
      siblings: ctx.siblings.map(toContextNode),
      fewShotItems: ctx.taggedItems
        .filter((item): item is typeof item & { stem: string } => Boolean(item.stem))
        .slice(0, MAX_FEW_SHOT_ITEMS)
        .map((item) => ({ type: item.type, stem: item.stem })),
    };
  }
}

function toContextNode(node: TaxonomyNodeRef): RemedialContextNode {
  return {
    code: node.code,
    name: node.name,
    description: node.description,
    type: node.type,
  };
}
