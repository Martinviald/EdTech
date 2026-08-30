import type { ParserResult } from './parser.types';
import { ZIPGRADE_PROFILE } from './format-profiles';
import { parseTabular } from './tabular-parser';

/**
 * Parser para el export de ZipGrade (CSV o Excel).
 *
 * Header `Student First Name, Student Last Name, Student ID, Q01, Q02, …`. Se
 * matchea por nombre de columna (no por posición) y las preguntas usan padding.
 */
export function parseZipgradeCsv(buffer: Buffer): ParserResult {
  return parseTabular(buffer, ZIPGRADE_PROFILE);
}
