import type { ResponseFormat, TranscriptionOutput } from '@soe/types';
import { partsSchema, type PartsJsonSchema } from './answer-format';
import { numericBoxesFor, type ResponseGeometry } from './response-geometry';

/**
 * Lectura por casilla: el lector informa el contenido de cada casilla impresa y
 * el valor se arma en código. En números, las casillas antes de la coma impresa
 * son `i1…iK`, las de después `f1…fM` y la del signo `sign`: la coma la pone la
 * geometría (el prefijo de la casilla), nunca el lector. Las secuencias ya piden
 * una parte por casilla (`e1…eN`).
 */
export const BOX_CELL_FORMAT_KINDS = ['integer', 'decimal', 'sequence'] as const;
export type BoxCellFormatKind = (typeof BOX_CELL_FORMAT_KINDS)[number];

type BoxCellFormat = Extract<ResponseFormat, { kind: BoxCellFormatKind }>;
type NumericFormat = Extract<ResponseFormat, { kind: 'integer' | 'decimal' }>;
type Parts = TranscriptionOutput['parts'];

export const SIGN_CELL_ID = 'sign';
const INTEGER_CELL = /^i(\d+)$/;
const FRACTION_CELL = /^f(\d+)$/;
const DECIMAL_SEPARATOR = ',';
const EMPTY_CELL_NOTE = 'vacío si la casilla no tiene escritura';

export function isBoxCellFormat(format: ResponseFormat): format is BoxCellFormat {
  return (BOX_CELL_FORMAT_KINDS as readonly string[]).includes(format.kind);
}

function cellIds(prefix: 'i' | 'f' | 'e', count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
}

function numericCellEntries(
  format: NumericFormat,
  geometry: ResponseGeometry,
): Array<readonly [string, string]> {
  const boxes = numericBoxesFor(format, geometry.fractionDigits);
  const entries: Array<readonly [string, string]> = [];
  if (boxes.signBox) {
    entries.push([
      SIGN_CELL_ID,
      `Casilla del signo: "-" si hay un signo menos manuscrito; ${EMPTY_CELL_NOTE}`,
    ]);
  }
  const integerPlace = format.kind === 'decimal' ? ' antes de la coma impresa' : '';
  cellIds('i', boxes.integerDigits).forEach((id, index) =>
    entries.push([id, `Casilla ${index + 1}${integerPlace}; ${EMPTY_CELL_NOTE}`]),
  );
  cellIds('f', boxes.fractionDigits).forEach((id, index) =>
    entries.push([id, `Casilla ${index + 1} después de la coma impresa; ${EMPTY_CELL_NOTE}`]),
  );
  return entries;
}

/** `parts` de la lectura por casilla, o `null` si el formato las pide igual que siempre. */
export function boxCellPartsSchema(
  format: ResponseFormat,
  geometry: ResponseGeometry,
): PartsJsonSchema | null {
  if (format.kind !== 'integer' && format.kind !== 'decimal') return null;
  return partsSchema(numericCellEntries(format, geometry));
}

export function boxCellSchemaShape(format: ResponseFormat, geometry: ResponseGeometry): string {
  if (format.kind === 'sequence') return `.${format.length}`;
  if (format.kind !== 'integer' && format.kind !== 'decimal') return '';
  const boxes = numericBoxesFor(format, geometry.fractionDigits);
  return `.${boxes.signBox ? 's' : ''}i${boxes.integerDigits}f${boxes.fractionDigits}`;
}

function idList(ids: readonly string[]): string {
  return ids.join(', ');
}

function numericGuide(format: NumericFormat, geometry: ResponseGeometry): string {
  const boxes = numericBoxesFor(format, geometry.fractionDigits);
  const integerIds = cellIds('i', boxes.integerDigits);
  const fractionIds = cellIds('f', boxes.fractionDigits);
  const sign = boxes.signBox
    ? `Primero hay una casilla para el signo: repórtala en "${SIGN_CELL_ID}" ("-" si el estudiante escribió un signo menos; vacío si no). `
    : '';
  const layout =
    format.kind === 'decimal'
      ? `${sign}La respuesta es un número con ${boxes.integerDigits} casillas, después una coma IMPRESA y después ${boxes.fractionDigits} casillas, todas en una fila. Reporta las casillas de antes de la coma impresa en ${idList(integerIds)} y las de después en ${idList(fractionIds)}, de izquierda a derecha.`
      : `${sign}La respuesta es un número entero con ${boxes.integerDigits} casillas en una fila, una por dígito. Repórtalas en ${idList(integerIds)}, de izquierda a derecha.`;
  const literal =
    format.kind === 'decimal'
      ? 'En "literal" escribe el número que forman las casillas, sin las vacías y con una coma en el lugar de la coma impresa (por ejemplo "2,75").'
      : 'En "literal" escribe los dígitos de las casillas seguidos, sin las vacías.';
  return `${layout} ${literal}`;
}

function sequenceGuide(format: Extract<ResponseFormat, { kind: 'sequence' }>): string {
  return `La respuesta es una secuencia de ${format.length} casillas en una fila, un elemento por casilla (un elemento puede tener más de un dígito). Reporta cada casilla en ${idList(cellIds('e', format.length))}, de izquierda a derecha. En "literal" escribe los elementos en ese orden, separados por "; ".`;
}

/** Descripción de las casillas impresas para el prompt (`formatGuide`). No menciona la clave. */
export function boxCellGuide(format: ResponseFormat, geometry: ResponseGeometry): string {
  if (format.kind === 'integer' || format.kind === 'decimal') {
    return numericGuide(format, geometry);
  }
  if (format.kind === 'sequence') return sequenceGuide(format);
  throw new Error(`El formato ${format.kind} no se lee por casilla`);
}

function cellRun(parts: Record<string, string>, pattern: RegExp): string | null {
  const cells: Array<[number, string]> = [];
  for (const [id, content] of Object.entries(parts)) {
    const match = pattern.exec(id);
    if (match?.[1]) cells.push([Number(match[1]), content.replace(/\s+/g, '')]);
  }
  if (cells.length === 0) return null;
  return cells
    .sort(([a], [b]) => a - b)
    .map(([, content]) => content)
    .join('');
}

/**
 * Número armado desde las casillas: el signo, los dígitos de antes de la coma y,
 * si hay alguno después, la coma y esos dígitos. Las casillas vacías no aportan.
 * `null` si la lectura no trae casillas (lecturas anteriores a la lectura por casilla).
 */
export function numericCellsText(parts: Parts): string | null {
  if (parts === null) return null;
  const integer = cellRun(parts, INTEGER_CELL);
  const fraction = cellRun(parts, FRACTION_CELL);
  if (integer === null && fraction === null) return null;
  const sign = (parts[SIGN_CELL_ID] ?? '').replace(/\s+/g, '');
  const tail = fraction !== null && fraction.length > 0 ? `${DECIMAL_SEPARATOR}${fraction}` : '';
  return `${sign}${integer ?? ''}${tail}`;
}

/** Sin dígitos antes de la coma: no se arma un número (",75" no se adivina). */
export function numericCellsEmpty(parts: Parts): boolean {
  if (parts === null) return false;
  const integer = cellRun(parts, INTEGER_CELL);
  const fraction = cellRun(parts, FRACTION_CELL);
  if (integer === null && fraction === null) return false;
  return (integer ?? '').length === 0;
}
