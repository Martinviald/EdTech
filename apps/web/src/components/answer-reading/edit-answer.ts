import type { ResponseFormatKind, ReviewQueueGroup } from '@soe/types';

/**
 * Forma del campo de edición según el formato de la casilla (diseño §11.2):
 * dos cajas para fracción, `( ; )` para par ordenado, una caja por casilla en
 * multicasilla y texto en los demás. El literal que se arma es el mismo que
 * escribe el lector (`n/d`, `(a;b)`, `a|b|c`), para que la API lo normalice
 * con el parser del formato.
 */
export type EditShape =
  | { kind: 'integer' }
  | { kind: 'decimal' }
  | { kind: 'fraction' }
  | { kind: 'tuple'; arity: number }
  | { kind: 'multi_box'; boxes: number }
  | { kind: 'text'; multiline: boolean };

export type EditBuildResult = { ok: true; literal: string } | { ok: false; message: string };

const MULTI_BOX_SEPARATOR = '|';
const TUPLE_SEPARATOR = ';';
const MIN_PARTS = 2;
const MAX_TUPLE_ARITY = 4;
const MAX_LITERAL_LENGTH = 500;
const INTEGER_RE = /^-?\d+$/;
const DECIMAL_RE = /^-?\d+([.,]\d+)?$/;
const MULTILINE_KINDS: ReadonlySet<ResponseFormatKind> = new Set(['free_text', 'math_work']);

function candidateLiterals(group: ReviewQueueGroup): string[] {
  const literals: string[] = [];
  if (group.displayValue) literals.push(group.displayValue);
  for (const reader of group.readers) {
    if (reader.literal) literals.push(reader.literal);
  }
  return literals;
}

export function tupleComponents(literal: string): string[] {
  const inner = literal.trim().replace(/^\(/, '').replace(/\)$/, '');
  return inner.split(TUPLE_SEPARATOR).map((part) => part.trim());
}

function partCount(literals: string[], split: (literal: string) => string[], max: number): number {
  let count = MIN_PARTS;
  for (const literal of literals) {
    count = Math.max(count, Math.min(max, split(literal).length));
  }
  return count;
}

function multiBoxParts(literal: string): string[] {
  return literal.split(MULTI_BOX_SEPARATOR).map((part) => part.trim());
}

export function editShapeFor(group: ReviewQueueGroup): EditShape {
  switch (group.formatKind) {
    case 'integer':
      return { kind: 'integer' };
    case 'decimal':
      return { kind: 'decimal' };
    case 'fraction':
      return { kind: 'fraction' };
    case 'ordered_tuple':
      return {
        kind: 'tuple',
        arity: partCount(candidateLiterals(group), tupleComponents, MAX_TUPLE_ARITY),
      };
    case 'multi_box':
      return {
        kind: 'multi_box',
        boxes: partCount(candidateLiterals(group), multiBoxParts, Number.POSITIVE_INFINITY),
      };
    default:
      return { kind: 'text', multiline: MULTILINE_KINDS.has(group.formatKind) };
  }
}

export function partsLength(shape: EditShape): number {
  if (shape.kind === 'fraction') return 2;
  if (shape.kind === 'tuple') return shape.arity;
  if (shape.kind === 'multi_box') return shape.boxes;
  return 1;
}

function fitParts(parts: string[], length: number): string[] {
  return Array.from({ length }, (_, index) => parts[index] ?? '');
}

export function initialParts(shape: EditShape, literal: string | null): string[] {
  const length = partsLength(shape);
  if (!literal) return fitParts([], length);
  if (shape.kind === 'fraction') {
    const [numerator = '', denominator = ''] = literal.split('/').map((part) => part.trim());
    return [numerator, denominator];
  }
  if (shape.kind === 'tuple') return fitParts(tupleComponents(literal), length);
  if (shape.kind === 'multi_box') return fitParts(multiBoxParts(literal), length);
  return [literal];
}

function finish(literal: string): EditBuildResult {
  if (literal.length > MAX_LITERAL_LENGTH) {
    return { ok: false, message: 'La respuesta no puede superar los 500 caracteres' };
  }
  return { ok: true, literal };
}

export function buildEditedLiteral(shape: EditShape, rawParts: string[]): EditBuildResult {
  const parts = fitParts(rawParts, partsLength(shape)).map((part) => part.trim());
  const [first = ''] = parts;

  switch (shape.kind) {
    case 'integer':
      return INTEGER_RE.test(first)
        ? finish(first)
        : { ok: false, message: 'Escribe un número entero, por ejemplo 42 o -3' };
    case 'decimal':
      return DECIMAL_RE.test(first)
        ? finish(first)
        : { ok: false, message: 'Escribe un número, por ejemplo 2,5 o -0,75' };
    case 'fraction': {
      const [numerator = '', denominator = ''] = parts;
      if (!INTEGER_RE.test(numerator) || !/^\d+$/.test(denominator)) {
        return { ok: false, message: 'Escribe el numerador y el denominador como números enteros' };
      }
      if (Number(denominator) === 0) {
        return { ok: false, message: 'El denominador no puede ser 0' };
      }
      return finish(`${numerator}/${denominator}`);
    }
    case 'tuple':
      if (parts.some((part) => part.length === 0)) {
        return { ok: false, message: 'Completa todos los componentes del par' };
      }
      return finish(`(${parts.join(TUPLE_SEPARATOR)})`);
    case 'multi_box':
      if (parts.some((part) => part.length === 0)) {
        return { ok: false, message: 'Completa todas las casillas' };
      }
      return finish(parts.join(MULTI_BOX_SEPARATOR));
    case 'text':
      return first.length > 0
        ? finish(first)
        : { ok: false, message: 'Escribe lo que respondió el alumno' };
  }
}
