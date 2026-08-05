// Corrección de una celda de hoja de respuestas.
//
// La ingesta y la re-corrección tienen que puntuar IGUAL: si una celda vale
// distinto según qué proceso la miró, el % de la pregunta cambia sin que nadie
// haya tocado un dato. Por eso la traducción del formato de la hoja y la elección
// de estrategia viven acá y no en cada script.
//
// Lo único específico de la hoja es `matching`: trae una secuencia posicional de
// dígitos ("2,5,3,4") y la estrategia corrige contra `content.correctPairs`. El
// resto de los tipos consume el string tal cual.

import type { ItemContent } from '../schemas/item-content.schema';
import type { ScoringConfig } from '../schemas/item.schema';
import type { ItemType } from '../enums';
import { parsePositionalMatchingAnswer, type MatchingSide } from '../utils/matching-answer';
import { getScoringStrategy } from './scoring-strategy';
import type { ScoringOutput } from './scoring-strategy';

/** El ítem, en la forma mínima que hace falta para corregir una celda. */
export type AnswerSheetItem = {
  id: string;
  type: ItemType;
  content: ItemContent;
  scoringConfig?: ScoringConfig | null;
};

function sidesOf(content: unknown, side: 'leftItems' | 'rightItems'): MatchingSide[] {
  const raw = (content as Record<string, unknown> | null)?.[side];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const { id } = entry as { id?: unknown };
    return typeof id === 'string' ? [{ id }] : [];
  });
}

/** Puntaje máximo del ítem: `scoring_config.points`, o 1 si no lo declara. */
export function maxScoreOf(item: Pick<AnswerSheetItem, 'scoringConfig'>): number {
  return (item.scoringConfig as { points?: number } | null)?.points ?? 1;
}

/** Traduce la celda al `rawAnswer` que espera la estrategia del tipo. */
function toStrategyAnswer(item: AnswerSheetItem, cell: string | null): unknown {
  if (cell === null) return null;
  if (item.type !== 'matching') return cell;
  return parsePositionalMatchingAnswer(
    cell,
    sidesOf(item.content, 'leftItems'),
    sidesOf(item.content, 'rightItems'),
  );
}

/**
 * Corrige una celda. `cell` es el valor crudo de la planilla; `null` (o vacío)
 * significa que el alumno no respondió, y cada estrategia decide qué es eso para
 * su tipo — cero en una de alternativas, pendiente en una de pauta.
 */
export function scoreAnswerSheetCell(item: AnswerSheetItem, cell: string | null): ScoringOutput {
  const answer = cell !== null && cell.trim().length > 0 ? cell.trim() : null;
  return getScoringStrategy(item.type).score({
    item: {
      id: item.id,
      type: item.type,
      content: item.content,
      maxScore: maxScoreOf(item),
      scoringConfig: item.scoringConfig ?? undefined,
    },
    rawAnswer: toStrategyAnswer(item, answer),
  });
}
