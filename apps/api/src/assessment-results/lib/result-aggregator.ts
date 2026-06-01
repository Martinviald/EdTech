// Helpers para leer responses + grading scale + tags y delegarlos al
// calculador puro de @soe/types. Mantiene el service delgado y testeable.

import type { GradingScaleParams, ResponseForCalculation } from '@soe/types';

export type ResponseRow = {
  studentId: string;
  itemId: string;
  isCorrect: boolean | null;
  rawScore: string | null;
  finalScore: string | null;
  maxScore: string;
  itemPosition: number;
};

/**
 * Convierte responses tal como vienen de la DB (decimales como strings) a la
 * forma que esperan los agregadores puros (`ResponseForCalculation`).
 */
export function toResponseForCalculation(
  rows: readonly ResponseRow[],
  tagsByItemId: Map<string, string[]>,
): ResponseForCalculation[] {
  return rows.map((r) => ({
    studentId: r.studentId,
    itemId: r.itemId,
    isCorrect: r.isCorrect,
    // Preferimos finalScore (override humano + AI consolidado) sobre rawScore.
    rawScore: r.finalScore != null ? Number(r.finalScore) : r.rawScore != null ? Number(r.rawScore) : null,
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
