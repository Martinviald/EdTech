/**
 * Clasificación jerárquica: descenso codicioso por un árbol, un Choice por nivel.
 * Sirve para taxonomías con más hojas de las que caben en un solo Choice.
 */

import {
  DECISION_LIMITS,
  DecisionError,
  type DecisionEngine,
  type DecisionState,
  type Description,
  type JsonObject,
} from './contracts';
import { choice } from './questions';

export interface DecisionTreeNode {
  readonly id: string;
  /** Nombre que ve el modelo. */
  readonly label: string;
  readonly description?: Description;
  readonly children?: readonly DecisionTreeNode[];
}

export interface HierarchicalChoiceOptions {
  readonly state: DecisionState;
  /** Instrucción común a todos los niveles ("¿Qué categoría describe mejor…?"). */
  readonly instructions: Description;
  /** Nodos raíz. */
  readonly tree: readonly DecisionTreeNode[];
  /** Se baja un nivel solo si `confidence >= minConfidence` (0..1). */
  readonly minConfidence: number;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface HierarchicalStep {
  readonly id: string;
  readonly confidence: number;
}

export interface HierarchicalChoiceResult {
  /** Nodos elegidos desde la raíz. El nodo de baja confianza NO entra. */
  readonly path: readonly HierarchicalStep[];
  readonly stoppedBecause: 'leaf' | 'low_confidence';
}

const QUESTION_ID = 'node';

/**
 * En cada nivel pregunta un Choice sobre los hijos y baja mientras
 * `confidence >= minConfidence` y haya hijos. Un nivel con un solo nodo no
 * llama al motor: se toma con confianza 1. Más de 255 hermanos → `invalid_request`.
 */
export async function hierarchicalChoice(
  engine: DecisionEngine,
  options: HierarchicalChoiceOptions,
): Promise<HierarchicalChoiceResult> {
  const { minConfidence } = options;
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    throw new DecisionError(
      'invalid_request',
      `minConfidence debe estar entre 0 y 1 (llegó ${minConfidence}).`,
    );
  }

  const path: HierarchicalStep[] = [];
  let level: readonly DecisionTreeNode[] = options.tree;
  for (;;) {
    const { node, confidence } = await chooseAmong(engine, options, level);
    if (confidence < minConfidence) return { path, stoppedBecause: 'low_confidence' };
    path.push({ id: node.id, confidence });
    if (node.children === undefined || node.children.length === 0)
      return { path, stoppedBecause: 'leaf' };
    level = node.children;
  }
}

async function chooseAmong(
  engine: DecisionEngine,
  options: HierarchicalChoiceOptions,
  siblings: readonly DecisionTreeNode[],
): Promise<{ node: DecisionTreeNode; confidence: number }> {
  assertValidSiblings(siblings);
  const [only] = siblings;
  if (siblings.length === 1 && only !== undefined) return { node: only, confidence: 1 };

  // Claves opacas (`c0`, `c1`…): el modelo lee el label en la descripción, no el id interno.
  const byKey = new Map<string, DecisionTreeNode>();
  const criteria: Record<string, Description> = {};
  siblings.forEach((node, index) => {
    const key = `c${index}`;
    byKey.set(key, node);
    criteria[key] = describeNode(node);
  });

  const result = await engine.evaluate({
    state: options.state,
    questions: { [QUESTION_ID]: choice(options.instructions, criteria) },
    model: options.model,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });

  const answer = result.answers[QUESTION_ID];
  const node = byKey.get(answer.choice);
  if (node === undefined) {
    throw new DecisionError(
      'upstream',
      'El motor eligió un nodo que no existe en este nivel del árbol.',
    );
  }
  return { node, confidence: answer.confidence };
}

function assertValidSiblings(siblings: readonly DecisionTreeNode[]): void {
  if (siblings.length === 0) {
    throw new DecisionError('invalid_request', 'El árbol no tiene nodos en este nivel.');
  }
  if (siblings.length > DECISION_LIMITS.maxChoiceOptions) {
    throw new DecisionError(
      'invalid_request',
      `Un nivel del árbol tiene ${siblings.length} hermanos; el máximo es ${DECISION_LIMITS.maxChoiceOptions}. Agrupa los nodos en subniveles.`,
    );
  }
  const seen = new Set<string>();
  for (const node of siblings) {
    if (seen.has(node.id))
      throw new DecisionError('invalid_request', `El id "${node.id}" se repite entre hermanos.`);
    seen.add(node.id);
  }
}

function describeNode(node: DecisionTreeNode): Description {
  if (node.description === undefined) return node.label;
  const described: JsonObject = { label: node.label, description: node.description };
  return described;
}
