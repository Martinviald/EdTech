import type { ParserResult } from './parser.types';
import { GRADECAM_PROFILE } from './format-profiles';
import { parseTabular } from './tabular-parser';

/**
 * Parser del export "Student By Question" de Gradecam (CSV o Excel): header
 * `Name, ID, GradeCam ID, 1, 2, …` precedido de filas de título, `Name` como
 * "Apellido, Nombre" y la fila final de pauta descartada. El perfil y el lector
 * tabular resuelven el resto.
 */
export function parseGradecamCsv(buffer: Buffer): ParserResult {
  return parseTabular(buffer, GRADECAM_PROFILE);
}
