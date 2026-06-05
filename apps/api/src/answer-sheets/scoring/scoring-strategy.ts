// ─────────────────────────────────────────────────────────────────────────────
// OLEADA B — #1 Registro de estrategias de scoring por tipo de ítem
//
// Problema histórico: la ingesta puntuaba TODO como opción múltiple
// (`rawAnswer === correctKey`), ignorando `item.type`. Un ítem no-MCQ obtenía
// `correctKey=''`, nunca matcheaba, y quedaba 0/incorrecto en silencio.
//
// Este registro desacopla la corrección del tipo de ítem (Open/Closed): cada
// `ItemType` tiene una `ScoringStrategy` que lee su `content` tipado. Agregar un
// tipo nuevo = agregar su entrada en `SCORING_STRATEGIES` (sin tocar el loop de
// ingesta). Los tipos no auto-scorables (`isAutoScorable(type) === false`)
// devuelven `requiresManualGrading: true` con scores null — NUNCA 0/incorrecto.
// ─────────────────────────────────────────────────────────────────────────────

import { isAutoScorable, type ItemContent, type ItemType } from '@soe/types';
import {
  gapFillStrategy,
  matchingStrategy,
  multipleChoiceStrategy,
  orderingStrategy,
  trueFalseStrategy,
} from './strategies';

/** Entrada de scoring: el ítem tipado + la respuesta cruda del alumno. */
export interface ScoringInput {
  item: { id: string; type: ItemType; content: ItemContent; maxScore: number };
  /** Valor crudo del alumno (letra, texto, pares, orden, etc.). `null` = sin responder. */
  rawAnswer: unknown;
}

/** Resultado de scoring. `null` en isCorrect/rawScore ⇒ pendiente de corrección. */
export interface ScoringOutput {
  isCorrect: boolean | null; // null = no autocorregible (pendiente humano/IA)
  rawScore: number | null; // null si pendiente
  requiresManualGrading: boolean;
}

export interface ScoringStrategy {
  score(input: ScoringInput): ScoringOutput;
}

// ── Estrategia de corrección manual (no auto-scorable) ───────────────────────
// open_ended, writing, oral_reading, oral_expression, listening: la máquina no
// puede corregirlos determinísticamente → quedan pendientes. El calculador puro
// excluye `isCorrect === null` del denominador, así que NO contaminan el % de
// los autocorregidos.
const manualGradingStrategy: ScoringStrategy = {
  score(): ScoringOutput {
    return { isCorrect: null, rawScore: null, requiresManualGrading: true };
  },
};

// ── Registro tipo → estrategia (punto de extensión único) ────────────────────
export const SCORING_STRATEGIES: Record<ItemType, ScoringStrategy> = {
  multiple_choice: multipleChoiceStrategy,
  true_false: trueFalseStrategy,
  matching: matchingStrategy,
  ordering: orderingStrategy,
  gap_fill: gapFillStrategy,
  // No auto-scorables → corrección humana/IA (F4).
  open_ended: manualGradingStrategy,
  writing: manualGradingStrategy,
  oral_reading: manualGradingStrategy,
  oral_expression: manualGradingStrategy,
  listening: manualGradingStrategy,
};

/**
 * Devuelve la estrategia de scoring para un `ItemType`. Si el tipo no es
 * auto-scorable según el contrato (`isAutoScorable`), garantiza la estrategia de
 * corrección manual aunque el registro se desincronizara (defensa en profundidad).
 */
export function getScoringStrategy(type: ItemType): ScoringStrategy {
  if (!isAutoScorable(type)) return manualGradingStrategy;
  return SCORING_STRATEGIES[type] ?? manualGradingStrategy;
}
