import type { AnswerSheetRowError } from '@soe/types';

/**
 * Fila parseada desde un archivo CSV/Excel de hojas de respuesta.
 *
 * - `studentRut`: tal cual viene en el archivo. La normalización canónica
 *   (chequear DV, formatear) ocurre en el matcher, no acá.
 * - `answers`: mapa de ETIQUETA IMPRESA (tal como la numera la hoja: "1", "12",
 *   "14.2", "7B1") → alternativa marcada, o null si en blanco.
 *
 *   ⚠️ La key NO es la `position` del ítem. El parser no conoce el instrumento,
 *   así que no puede resolverla: en un cuadernillo con sub-numeración el número
 *   impreso y la posición NO coinciden (Ciencias 8° 2026 imprime `14.1..14.5`
 *   sobre posiciones correlativas). Traducir etiqueta → `position` es trabajo del
 *   service, que sí tiene los ítems — ver `lib/composite-answers.ts`.
 *
 * - `errors`: errores específicos de la fila — el parser igual la incluye
 *   para que el matcher/preview reporte todo de una vez.
 */
export interface ParsedAnswerSheetRow {
  rowNumber: number;
  studentRut: string | null;
  studentFullName: string | null;
  answers: Record<string, string | null>;
  annulledLabels?: string[];
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
 * Etiqueta impresa de una columna de pregunta, sin el prefijo del proveedor:
 *
 *   "Q12"  → "12"        "Q14.2" → "14.2"
 *   "7B1"  → "7B1"       "p9.1"  → "9.1"
 *
 * Preserva la sub-numeración TAL CUAL: es lo que permite después distinguir un
 * ítem propio (`14.2`) de una sub-respuesta de un ítem compuesto (`7B1`), cosa
 * que sólo se puede decidir contra el instrumento. Si no contiene dígitos o el
 * número base es 0, retorna null.
 */
export function questionColumnToLabel(column: string): string | null {
  const m = column.trim().match(/^[^\d]*(\d+)(.*)$/);
  if (!m || !m[1]) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;

  const rest = (m[2] ?? '').trim();
  return `${n}${rest}`;
}

/**
 * Escribe la respuesta de una columna en el mapa de la fila. Es el único punto
 * donde los 4 parsers escriben `answers`, para que la regla sea una sola.
 */
export function assignAnswer(
  answers: Record<string, string | null>,
  column: string,
  rawValue: string | undefined | null,
): void {
  const label = questionColumnToLabel(column);
  if (!label) return;
  answers[label] = normalizeAnswerValue(rawValue);
}

/**
 * Normaliza el valor de una respuesta. Soporta blank = "", "-", "_" → null.
 * Devuelve la alternativa en MAYÚSCULA (la convención del banco de ítems).
 */
export function normalizeAnswerValue(value: string | undefined | null): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '_') return null;
  return trimmed.toUpperCase();
}

/**
 * Forma canónica de un encabezado para cruzarlo con alias: sin acentos,
 * minúscula, espacios colapsados. `"Student First Name"` → `"student first name"`,
 * `"Apellidos "` → `"apellidos"`.
 */
export function normalizeHeaderText(value: string | undefined | null): string {
  if (value === null || value === undefined) return '';
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
