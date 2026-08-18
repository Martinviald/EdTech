import type { AnswerSheetColumnMapping } from '@soe/types';
import { normalizeHeaderText } from './parser.types';
import type { FormatProfile } from './format-profiles';

function firstNonEmptyRowIndex(matrix: readonly string[][]): number {
  for (let i = 0; i < matrix.length; i++) {
    if (matrix[i].some((cell) => cell.trim() !== '')) return i;
  }
  return -1;
}

function countQuestionColumns(row: readonly string[], profile: FormatProfile): number {
  return row.filter((cell) => profile.questionRegex.test(cell.trim())).length;
}

function hasIdentityColumn(row: readonly string[], profile: FormatProfile): boolean {
  const ignore = new Set(profile.ignoreColumns);
  return row.some((cell) => {
    const norm = normalizeHeaderText(cell);
    return norm.length > 0 && !ignore.has(norm) && profile.identityAliases.includes(norm);
  });
}

function locateMappingHeader(
  matrix: readonly string[][],
  mapping: AnswerSheetColumnMapping,
): number {
  const targets = new Set(
    [mapping.rut, ...(mapping.questionColumns ?? [])]
      .filter((c): c is string => !!c)
      .map((c) => normalizeHeaderText(c)),
  );
  if (targets.size > 0) {
    for (let i = 0; i < matrix.length; i++) {
      if (matrix[i].some((cell) => targets.has(normalizeHeaderText(cell)))) return i;
    }
  }
  return firstNonEmptyRowIndex(matrix);
}

/**
 * Índice de la fila de encabezado. GradeCam antepone filas de título/subtítulo/
 * timestamp, así que no se asume la fila 0: se busca la primera fila con una
 * columna de identidad y suficientes columnas de pregunta.
 */
export function locateHeaderRow(
  matrix: readonly string[][],
  profile: FormatProfile,
  mapping: AnswerSheetColumnMapping | null,
): number {
  if (matrix.length === 0) return -1;
  if (mapping) return locateMappingHeader(matrix, mapping);

  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    if (
      hasIdentityColumn(row, profile) &&
      countQuestionColumns(row, profile) >= profile.minQuestionColsForHeader
    ) {
      return i;
    }
  }
  return firstNonEmptyRowIndex(matrix);
}
