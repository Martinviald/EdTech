import type { AnswerSheetColumnMapping } from '@soe/types';
import type { ParserResult } from './parser.types';
import type { FormatProfile } from './format-profiles';
import { readTabularMatrix } from './tabular-reader';
import { locateHeaderRow } from './header-detection';
import { resolveColumns } from './column-resolver';
import { extractRows } from './row-extractor';

export function parseTabular(
  buffer: Buffer,
  profile: FormatProfile,
  mapping: AnswerSheetColumnMapping | null = null,
): ParserResult {
  const matrix = readTabularMatrix(buffer);
  if (matrix.length === 0) {
    return { rows: [], detectedColumns: [], warnings: ['El archivo está vacío o no se pudo leer.'] };
  }

  const headerIndex = locateHeaderRow(matrix, profile, mapping);
  if (headerIndex === -1) {
    return {
      rows: [],
      detectedColumns: [],
      warnings: ['No se pudo detectar la fila de encabezado del archivo.'],
    };
  }

  const columns = resolveColumns(matrix[headerIndex], profile, mapping);
  return extractRows(matrix, headerIndex, columns, profile);
}
