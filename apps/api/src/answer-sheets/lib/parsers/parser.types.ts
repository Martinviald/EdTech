import type { AnswerSheetRowError } from '@soe/types';

/**
 * Respuesta de un alumno a UNA posición del instrumento.
 *
 * - `string | null`: el caso normal — una alternativa marcada, o en blanco.
 * - `Record<string, string>`: un ítem COMPUESTO, cuyo escaneo trae varias
 *   sub-columnas para una sola pregunta impresa (`7B1`, `7B2`, … o `9.1`,
 *   `9.2`, …). Se indexa por la sub-etiqueta y se resuelve más arriba, donde se
 *   conoce el `item.type` — el parser no sabe de tipos de ítem.
 */
export type ParsedAnswerValue = string | null | Record<string, string>;

/**
 * Fila parseada desde un archivo CSV/Excel de hojas de respuesta.
 *
 * - `studentRut`: tal cual viene en el archivo. La normalización canónica
 *   (chequear DV, formatear) ocurre en el matcher, no acá.
 * - `answers`: mapa de `position` (string, ej. "1", "12") → respuesta del alumno
 *   (ver `ParsedAnswerValue`).
 * - `errors`: errores específicos de la fila — el parser igual la incluye
 *   para que el matcher/preview reporte todo de una vez.
 */
export interface ParsedAnswerSheetRow {
  rowNumber: number;
  studentRut: string | null;
  studentFullName: string | null;
  answers: Record<string, ParsedAnswerValue>;
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
  return parseQuestionColumn(column)?.position ?? null;
}

/**
 * Separa una columna de pregunta en la posición del ítem y, si la trae, la
 * sub-etiqueta de una sub-pregunta:
 *
 *   "Q12"  → { position: "12", subKey: null }
 *   "7B1"  → { position: "7",  subKey: "B1" }
 *   "9.1"  → { position: "9",  subKey: "1"  }
 *   "19.5" → { position: "19", subKey: "5"  }
 *
 * ⚠️ Antes de esto, la posición se sacaba con un único `match(/(\d+)/)`, así que
 * `7B1`…`7B4` colapsaban todas en la posición `7` y ganaba la última EN SILENCIO
 * (mismo bug con `9.1..9.4` y `19.1..19.5`). Distinguir la sub-etiqueta es lo que
 * permite reconstruir la respuesta compuesta en vez de perderla.
 */
export function parseQuestionColumn(
  column: string,
): { position: string; subKey: string | null } | null {
  const m = column.trim().match(/^[^\d]*(\d+)(.*)$/);
  if (!m || !m[1]) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;

  const rest = (m[2] ?? '')
    .trim()
    .replace(/^[.\-_:]+/, '')
    .trim();
  return { position: String(n), subKey: rest.length > 0 ? rest : null };
}

/**
 * Escribe la respuesta de una columna en el mapa de la fila, agrupando las
 * sub-columnas de un mismo ítem en un único valor compuesto. Es el único punto
 * donde los 4 parsers escriben `answers`, para que la regla sea una sola.
 */
export function assignAnswer(
  answers: Record<string, ParsedAnswerValue>,
  column: string,
  rawValue: string | undefined | null,
): void {
  const parsed = parseQuestionColumn(column);
  if (!parsed) return;
  const value = normalizeAnswerValue(rawValue);

  if (parsed.subKey === null) {
    answers[parsed.position] = value;
    return;
  }

  const existing = answers[parsed.position];
  const composite =
    existing !== null && typeof existing === 'object' ? existing : ({} as Record<string, string>);
  if (value !== null) composite[parsed.subKey] = value;
  answers[parsed.position] = composite;
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
