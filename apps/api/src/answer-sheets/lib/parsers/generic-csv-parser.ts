import type { AnswerSheetColumnMapping } from '@soe/types';
import type { ParserResult } from './parser.types';
import { GENERIC_PROFILE } from './format-profiles';
import { parseTabular } from './tabular-parser';

/**
 * Parser CSV/Excel genérico configurable vía `columnMapping`:
 *  - `rut`, `firstName`, `lastName`: nombres exactos de esas columnas.
 *  - `questionsPrefix` o `questionColumns`: cómo detectar las preguntas.
 *
 * La etiqueta canónica de cada pregunta se deriva de los dígitos de la columna,
 * no del orden, para que el archivo pueda omitir columnas.
 */
export function parseGenericCsv(buffer: Buffer, mapping: AnswerSheetColumnMapping): ParserResult {
  const warnings: string[] = [];
  if (!mapping.rut) {
    warnings.push('columnMapping.rut no especificado: las filas no se podrán matchear con alumnos.');
  }
  if (!mapping.questionsPrefix && (!mapping.questionColumns || mapping.questionColumns.length === 0)) {
    warnings.push('columnMapping no indica questionsPrefix ni questionColumns: no se detectaron preguntas.');
  }

  const result = parseTabular(buffer, GENERIC_PROFILE, mapping);
  return { ...result, warnings: [...warnings, ...result.warnings] };
}
