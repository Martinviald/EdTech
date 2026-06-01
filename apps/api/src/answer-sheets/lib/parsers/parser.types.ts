import type { AnswerSheetRowError } from '@soe/types';

/**
 * Fila parseada desde un archivo CSV/Excel de hojas de respuesta.
 *
 * - `studentRut`: tal cual viene en el archivo. La normalización canónica
 *   (chequear DV, formatear) ocurre en el matcher, no acá.
 * - `answers`: mapa de `position` (string, ej. "1", "12") → alternativa
 *   seleccionada (ej. "A", "B"), o null si en blanco.
 * - `errors`: errores específicos de la fila — el parser igual la incluye
 *   para que el matcher/preview reporte todo de una vez.
 */
export interface ParsedAnswerSheetRow {
  rowNumber: number;
  studentRut: string | null;
  studentFullName: string | null;
  answers: Record<string, string | null>;
  errors: AnswerSheetRowError[];
}

/**
 * Resultado uniforme de cualquier parser. La key del contrato compartido
 * entre los 4 parsers + el service.
 */
export interface ParserResult {
  rows: ParsedAnswerSheetRow[];
  detectedColumns: string[];
  warnings: string[];
}

/**
 * Decodifica un buffer (UTF-8, opcional BOM, fallback latin1) a string.
 * Idéntico al usado en `students-import.helpers.ts`; lo replicamos acá
 * para no romper el aislamiento del módulo.
 */
export function decodeCsvBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString('utf-8');
  }
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return decoder.decode(buffer);
  } catch {
    return buffer.toString('latin1');
  }
}

/**
 * Normaliza una clave de pregunta como "Q1", "Q01", "p1", "1" → posición
 * numérica como string ("1", "12"). Si no contiene dígitos, retorna null.
 */
export function questionColumnToPosition(column: string): string | null {
  const m = column.match(/(\d+)/);
  if (!m || !m[1]) return null;
  // Parse para quitar leading zeros y volver a string (canonical "1", "12").
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(n);
}

/**
 * Normaliza el valor de una respuesta. Soporta blank = "", "-", "_", "0" → null.
 * Devuelve la alternativa en MAYÚSCULA (la convención del banco de ítems).
 */
export function normalizeAnswerValue(value: string | undefined | null): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '_') return null;
  return trimmed.toUpperCase();
}
