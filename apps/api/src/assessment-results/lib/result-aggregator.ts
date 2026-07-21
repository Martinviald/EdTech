// Helpers para leer responses + grading scale + tags y delegarlos al
// calculador puro de @soe/types. Mantiene el service delgado y testeable.

import type { GradingScaleParams } from '@soe/types';
import type { ResponseForPersist } from './persist-results';

export type ResponseRow = {
  studentId: string;
  itemId: string;
  /** JSONB crudo de `responses.value` — lo consume el read-model de cohorte. */
  value: Record<string, unknown> | null;
  /** JSONB crudo de `items.content` — de acá sale `hasAlternatives`. */
  itemContent: Record<string, unknown> | null;
  isCorrect: boolean | null;
  rawScore: string | null;
  finalScore: string | null;
  maxScore: string;
  itemPosition: number;
};

/**
 * ¿El ítem ofrece alternativas (selección múltiple)?
 *
 * El read-model lo necesita para no confundir un ítem de desarrollo con una respuesta
 * MC en blanco: ambos dan `extractRawAnswer → null`, y sin distinguirlos el desarrollo
 * colapsaría en un único bucket de blancos en vez de RC/RPC/RI.
 */
function hasAlternatives(content: Record<string, unknown> | null): boolean {
  const alternatives = content?.alternatives;
  return Array.isArray(alternatives) && alternatives.length > 0;
}

/**
 * Convierte responses tal como vienen de la DB (decimales como strings) a la
 * forma que esperan los agregadores puros.
 */
export function toResponseForCalculation(
  rows: readonly ResponseRow[],
  tagsByItemId: Map<string, string[]>,
): ResponseForPersist[] {
  return rows.map((r) => ({
    studentId: r.studentId,
    itemId: r.itemId,
    value: r.value,
    hasAlternatives: hasAlternatives(r.itemContent),
    isCorrect: r.isCorrect,
    // Preferimos finalScore (override humano + AI consolidado) sobre rawScore.
    rawScore:
      r.finalScore != null ? Number(r.finalScore) : r.rawScore != null ? Number(r.rawScore) : null,
    maxScore: Number(r.maxScore),
    itemPosition: r.itemPosition,
    taxonomyNodeIds: tagsByItemId.get(r.itemId) ?? [],
  }));
}

/**
 * Default linear chilean grading scale para cuando ni el body ni el instrumento
 * traen una escala. Configurable por convención chilena 1.0-7.0 con 60% de
 * exigencia para nota de aprobación (4.0).
 */
export function defaultLinearChileanScale(): GradingScaleParams {
  return {
    type: 'linear_chilean',
    minGrade: 1,
    maxGrade: 7,
    passingGrade: 4,
    passingThreshold: 0.6,
    config: null,
  };
}
