import type { ResponseFormat } from '@soe/types';

/**
 * Forma del campo de edición según el `responseFormat` del ítem (diseño §11.2):
 * dos cajas para fracción (tres si admite número mixto), `( ; )` para par
 * ordenado, una caja por casilla en multicasilla y texto en los demás. El
 * literal que se arma es el mismo que escribe el lector (`n/d`, `w n/d`,
 * `(a;b)`, `a|b|c`), para que la API lo normalice con el parser del formato.
 */
export type NumericKind = 'integer' | 'decimal' | 'fraction';
export type BoxKind = NumericKind | 'short_text';

export interface EditBox {
  label: string;
  kind: BoxKind;
}

export type EditShape =
  | { kind: 'integer'; allowNegative: boolean }
  | { kind: 'decimal'; allowNegative: boolean }
  | { kind: 'fraction'; allowNegative: boolean; mixed: boolean }
  | { kind: 'tuple'; arity: number; componentKind: NumericKind }
  | { kind: 'multi_box'; boxes: EditBox[] }
  | { kind: 'text'; multiline: boolean };

export type EditBuildResult = { ok: true; literal: string } | { ok: false; message: string };

const MULTI_BOX_SEPARATOR = '|';
const TUPLE_SEPARATOR = ';';
const MAX_LITERAL_LENGTH = 500;
const INTEGER_RE = /^-?\d+$/;
const DECIMAL_RE = /^-?\d+([.,]\d+)?$/;
const FRACTION_RE = /^-?\d+\/\d+$/;

export function editShapeFor(format: ResponseFormat): EditShape {
  switch (format.kind) {
    case 'integer':
      return { kind: 'integer', allowNegative: format.allowNegative };
    case 'decimal':
      return { kind: 'decimal', allowNegative: format.allowNegative };
    case 'fraction':
      return { kind: 'fraction', allowNegative: format.allowNegative, mixed: format.allowMixed };
    case 'ordered_tuple':
      return { kind: 'tuple', arity: format.arity, componentKind: format.componentKind };
    case 'multi_box':
      return {
        kind: 'multi_box',
        boxes: format.boxes.map((box) => ({ label: box.label, kind: box.kind })),
      };
    case 'free_text':
    case 'math_work':
      return { kind: 'text', multiline: true };
    default:
      return { kind: 'text', multiline: false };
  }
}

export function partsLength(shape: EditShape): number {
  if (shape.kind === 'fraction') return shape.mixed ? 3 : 2;
  if (shape.kind === 'tuple') return shape.arity;
  if (shape.kind === 'multi_box') return shape.boxes.length;
  return 1;
}

function fitParts(parts: string[], length: number): string[] {
  return Array.from({ length }, (_, index) => parts[index] ?? '');
}

function splitTrim(literal: string, separator: string): string[] {
  return literal.split(separator).map((part) => part.trim());
}

export function tupleComponents(literal: string): string[] {
  const inner = literal.trim().replace(/^\(/, '').replace(/\)$/, '');
  return splitTrim(inner, TUPLE_SEPARATOR);
}

function fractionParts(literal: string, mixed: boolean): string[] {
  const trimmed = literal.trim();
  const spaceIndex = trimmed.lastIndexOf(' ');
  const whole = mixed && spaceIndex > 0 ? trimmed.slice(0, spaceIndex).trim() : '';
  const fraction = whole ? trimmed.slice(spaceIndex + 1) : trimmed;
  const [numerator = '', denominator = ''] = splitTrim(fraction, '/');
  return mixed ? [whole, numerator, denominator] : [numerator, denominator];
}

export function initialParts(shape: EditShape, literal: string | null): string[] {
  const length = partsLength(shape);
  if (!literal) return fitParts([], length);
  if (shape.kind === 'fraction') return fractionParts(literal, shape.mixed);
  if (shape.kind === 'tuple') return fitParts(tupleComponents(literal), length);
  if (shape.kind === 'multi_box') return fitParts(splitTrim(literal, MULTI_BOX_SEPARATOR), length);
  return [literal];
}

function finish(literal: string): EditBuildResult {
  if (literal.length > MAX_LITERAL_LENGTH) {
    return { ok: false, message: 'La respuesta no puede superar los 500 caracteres' };
  }
  return { ok: true, literal };
}

function isNumeric(value: string, kind: NumericKind): boolean {
  if (kind === 'integer') return INTEGER_RE.test(value);
  if (kind === 'decimal') return DECIMAL_RE.test(value);
  return FRACTION_RE.test(value) || INTEGER_RE.test(value);
}

const NUMERIC_HINT: Record<NumericKind, string> = {
  integer: 'un número entero',
  decimal: 'un número',
  fraction: 'una fracción numerador/denominador',
};

function negativeNotAllowed(value: string, allowNegative: boolean): boolean {
  return !allowNegative && value.startsWith('-');
}

function buildFraction(
  shape: Extract<EditShape, { kind: 'fraction' }>,
  parts: string[],
): EditBuildResult {
  const [whole, numerator = '', denominator = ''] = shape.mixed ? parts : ['', ...parts];
  if (!INTEGER_RE.test(numerator) || !/^\d+$/.test(denominator)) {
    return { ok: false, message: 'Escribe el numerador y el denominador como números enteros' };
  }
  if (Number(denominator) === 0) return { ok: false, message: 'El denominador no puede ser 0' };
  if (whole && !INTEGER_RE.test(whole)) {
    return { ok: false, message: 'La parte entera debe ser un número entero' };
  }
  if (negativeNotAllowed(whole || numerator, shape.allowNegative)) {
    return { ok: false, message: 'Esta pregunta no admite números negativos' };
  }
  const fraction = `${numerator}/${denominator}`;
  return finish(whole ? `${whole} ${fraction}` : fraction);
}

export function buildEditedLiteral(shape: EditShape, rawParts: string[]): EditBuildResult {
  const parts = fitParts(rawParts, partsLength(shape)).map((part) => part.trim());
  const [first = ''] = parts;

  switch (shape.kind) {
    case 'integer':
    case 'decimal':
      if (!isNumeric(first, shape.kind)) {
        return {
          ok: false,
          message:
            shape.kind === 'integer'
              ? 'Escribe un número entero, por ejemplo 42'
              : 'Escribe un número, por ejemplo 2,5',
        };
      }
      if (negativeNotAllowed(first, shape.allowNegative)) {
        return { ok: false, message: 'Esta pregunta no admite números negativos' };
      }
      return finish(first);
    case 'fraction':
      return buildFraction(shape, parts);
    case 'tuple':
      if (parts.some((part) => part.length === 0)) {
        return { ok: false, message: 'Completa todos los componentes del par' };
      }
      if (parts.some((part) => !isNumeric(part, shape.componentKind))) {
        return {
          ok: false,
          message: `Cada componente del par debe ser ${NUMERIC_HINT[shape.componentKind]}`,
        };
      }
      return finish(`(${parts.join(TUPLE_SEPARATOR)})`);
    case 'multi_box': {
      const emptyIndex = parts.findIndex((part) => part.length === 0);
      if (emptyIndex >= 0) {
        return { ok: false, message: 'Completa todas las casillas' };
      }
      const invalid = shape.boxes.findIndex(
        (box, index) => box.kind !== 'short_text' && !isNumeric(parts[index] ?? '', box.kind),
      );
      const invalidBox = shape.boxes[invalid];
      if (invalidBox && invalidBox.kind !== 'short_text') {
        return {
          ok: false,
          message: `La casilla «${invalidBox.label}» debe ser ${NUMERIC_HINT[invalidBox.kind]}`,
        };
      }
      return finish(parts.join(MULTI_BOX_SEPARATOR));
    }
    case 'text':
      return first.length > 0
        ? finish(first)
        : { ok: false, message: 'Escribe lo que respondió el alumno' };
  }
}
