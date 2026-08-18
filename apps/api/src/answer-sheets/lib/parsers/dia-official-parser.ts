import type { ParserResult } from './parser.types';
import { DIA_OFFICIAL_PROFILE } from './format-profiles';
import { parseTabular } from './tabular-parser';

/**
 * Parser para el CSV/Excel oficial de la Agencia de Calidad (formato DIA).
 *
 * Header `RUT, Apellidos, Nombres, p1, p2, …`. Apellidos y Nombres llegan
 * separados y se concatenan en `studentFullName`.
 */
export function parseDiaOfficialCsv(buffer: Buffer): ParserResult {
  return parseTabular(buffer, DIA_OFFICIAL_PROFILE);
}
