import { Inject, Injectable } from '@nestjs/common';
import type { TaxonomyNodeRef } from '@soe/types';
import {
  CURRICULUM_RETRIEVER,
  type CurriculumRetriever,
  type ReferenceItemRef,
} from '../curriculum-retriever/curriculum-retriever';

/**
 * Few-shot máximo de ítems etiquetados que se inyectan en el prompt (acota tokens
 * y evita arrastrar todo el banco). El retriever ya limita su propio resultado.
 */
const MAX_FEW_SHOT_ITEMS = 5;

/**
 * Máximo de ítems de referencia COMPLETOS (enunciado + alternativas + clave +
 * explicación) que se pasan al generador de práctica. Se mantiene acotado porque
 * cada ítem completo pesa mucho más en tokens que un few-shot de solo `stem`.
 */
const MAX_REFERENCE_ITEMS = 6;

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
 * Ítem de referencia COMPLETO para el generador de práctica (G5). A diferencia del
 * few-shot (solo `stem`), trae el ítem entero para anclar estilo/nivel: enunciado +
 * alternativas + clave + explicación, más la procedencia en el árbol de taxonomía.
 * Sin PII (solo contenido del banco de ítems).
 */
export interface RemedialReferenceItem {
  type: string;
  stem: string;
  alternatives: { key: string; text: string; isCorrect: boolean }[] | null;
  correctKey: string | null;
  explanation: string | null;
  fromNode: 'target' | 'sibling' | 'ancestor';
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
  // Ítems de referencia completos (G5), para el generador de práctica. Opcional
  // por compat: los prompts guide/group_plan consumen `fewShotItems`, no este campo.
  referenceItems?: RemedialReferenceItem[];
}

/**
 * Ensamblador del contexto RAG (H9.1). Inyecta el `CurriculumRetriever` (puerto
 * `CURRICULUM_RETRIEVER`, recuperación curricular estructurada sobre
 * `taxonomy_nodes`, sin embeddings) y arma un objeto curricular para los prompts:
 * OA objetivo + ancestros + descriptores + hermanos + few-shot de ítems
 * etiquetados + ítems de referencia completos. Anti-alucinación: el modelo trabaja
 * sobre el OA real y ejemplos reales. NUNCA incluye PII.
 */
@Injectable()
export class RemedialContextService {
  constructor(
    @Inject(CURRICULUM_RETRIEVER)
    private readonly retriever: CurriculumRetriever,
  ) {}

  /**
   * Recupera y ensambla el contexto curricular para un `nodeId` (la brecha).
   * `orgId` (opcional) restringe el pool de ítems al banco visible por la org.
   */
  async assemble(nodeId: string, orgId?: string): Promise<RemedialCurriculumContext> {
    const ctx = await this.retriever.getContext(nodeId, orgId);

    // Un solo filtro por `stem`: los ítems sin enunciado no sirven ni como
    // few-shot ni como referencia completa.
    const withStem = ctx.taggedItems.filter(
      (item): item is ReferenceItemRef & { stem: string } => Boolean(item.stem),
    );

    return {
      nodeId,
      target: toContextNode(ctx.node),
      ancestors: ctx.ancestors.map(toContextNode),
      descriptors: ctx.descriptors.map(toContextNode),
      siblings: ctx.siblings.map(toContextNode),
      fewShotItems: withStem
        .slice(0, MAX_FEW_SHOT_ITEMS)
        .map((item) => ({ type: item.type, stem: item.stem })),
      referenceItems: withStem.slice(0, MAX_REFERENCE_ITEMS).map(toReferenceItem),
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

function toReferenceItem(item: ReferenceItemRef & { stem: string }): RemedialReferenceItem {
  return {
    type: item.type,
    stem: item.stem,
    alternatives: item.alternatives ?? null,
    correctKey: item.correctKey ?? null,
    explanation: item.explanation ?? null,
    fromNode: item.fromNode,
  };
}
