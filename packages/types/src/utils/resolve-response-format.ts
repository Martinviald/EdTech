import {
  responseFormatSchema,
  type ResponseFormat,
} from '../schemas/answer-reading/response-format.schema';
import type { ItemType } from '../enums';
import { inferComparisonMode } from './short-answer';

// Formato de respuesta de un ítem (diseño §5.3). Si el ítem lo declara en
// `content.responseFormat`, manda ese. Si no, se deduce del tipo y de la pauta:
// la clave dice cómo se escribe la respuesta (`21/10` es fracción, `(7;3)` par
// ordenado, `3-1-4-2` secuencia). `null` = el ítem no tiene un formato que la
// hoja sepa imprimir.

export interface ResponseFormatSource {
  type: ItemType;
  content: unknown;
}

const NUMBER_SLACK_CHARS = 2;
const TEXT_SLACK_WORDS = 2;
const MAX_NUMBER_CHARS = 12;
const MAX_TEXT_WORDS = 40;
const DEFAULT_FREE_TEXT_LINES = 6;
const DEFAULT_WRITING_LINES = 15;
const WORDS_PER_LINE = 10;
const MAX_FREE_TEXT_LINES = 30;
const DEFAULT_SHORT_TEXT_WORDS = 10;

const INTEGER = /^[+-]?\d+$/;
const DECIMAL = /^[+-]?\d*[.,]\d+$/;
const FRACTION = /^[+-]?\d+\s*\/\s*\d+$/;
const MIXED_FRACTION = /^[+-]?\d+\s+\d+\s*\/\s*\d+$/;
const PARENTHESIZED = /^\((.+)\)$/;
const DASHED_SEQUENCE = /^\d+(\s*[-–]\s*\d+)+$/;
const COMMA_SEQUENCE = /^\d+(\s*[,;]\s*\d+){2,}$/;

type NumberKind = 'integer' | 'decimal' | 'fraction';
type KeyShape =
  | { kind: NumberKind; negative: boolean; mixed: boolean; length: number }
  | { kind: 'ordered_tuple'; components: string[] }
  | { kind: 'sequence'; length: number }
  | { kind: 'text'; words: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function unsignedLength(key: string): number {
  return key.replace(/^[+-]/, '').replace(/\s+/g, '').length;
}

function numberShape(key: string): KeyShape | null {
  const negative = key.startsWith('-');
  if (INTEGER.test(key))
    return { kind: 'integer', negative, mixed: false, length: unsignedLength(key) };
  if (DECIMAL.test(key))
    return { kind: 'decimal', negative, mixed: false, length: unsignedLength(key) };
  if (FRACTION.test(key))
    return { kind: 'fraction', negative, mixed: false, length: unsignedLength(key) };
  if (MIXED_FRACTION.test(key)) {
    return { kind: 'fraction', negative, mixed: true, length: unsignedLength(key) };
  }
  return null;
}

function tupleComponents(inner: string): string[] {
  const separator = inner.includes(';') ? ';' : ',';
  return inner.split(separator).map((component) => component.trim());
}

function keyShape(rawKey: string, comparison: string | undefined): KeyShape {
  const key = rawKey.trim().replace(/\s+/g, ' ');
  const parenthesized = PARENTHESIZED.exec(key);
  if (parenthesized && comparison !== 'text') {
    const components = tupleComponents(parenthesized[1]!);
    if (components.length >= 2 && components.every((component) => numberShape(component))) {
      return { kind: 'ordered_tuple', components };
    }
  }

  if (comparison !== 'text') {
    if (DASHED_SEQUENCE.test(key) || (comparison === 'sequence' && /\d/.test(key))) {
      const elements = key.match(/\d+/g) ?? [];
      if (elements.length >= 2) return { kind: 'sequence', length: elements.length };
    }
    const number = numberShape(key);
    if (number && comparison !== 'sequence') return number;
    if (COMMA_SEQUENCE.test(key)) {
      return { kind: 'sequence', length: (key.match(/\d+/g) ?? []).length };
    }
  }

  return { kind: 'text', words: key.split(' ').filter(Boolean).length };
}

function componentKindOf(components: readonly string[]): NumberKind {
  const kinds = components.map((component) => numberShape(component)?.kind ?? 'integer');
  if (kinds.includes('fraction')) return 'fraction';
  if (kinds.includes('decimal')) return 'decimal';
  return 'integer';
}

function numberFormat(
  kind: NumberKind,
  shapes: readonly Extract<KeyShape, { kind: NumberKind }>[],
): ResponseFormat {
  const allowNegative = shapes.some((shape) => shape.negative);
  if (kind === 'fraction') {
    return { kind: 'fraction', allowNegative, allowMixed: shapes.some((shape) => shape.mixed) };
  }
  const longest = Math.max(...shapes.map((shape) => shape.length));
  return {
    kind,
    maxChars: clamp(longest + NUMBER_SLACK_CHARS, 1, MAX_NUMBER_CHARS),
    allowNegative,
  };
}

function isNumberShape(shape: KeyShape): shape is Extract<KeyShape, { kind: NumberKind }> {
  return shape.kind === 'integer' || shape.kind === 'decimal' || shape.kind === 'fraction';
}

function shortAnswerFormat(content: Record<string, unknown>): ResponseFormat {
  const accepted = Array.isArray(content.acceptedAnswers)
    ? content.acceptedAnswers.filter(
        (answer): answer is string => typeof answer === 'string' && answer.trim().length > 0,
      )
    : [];
  const comparison = typeof content.comparison === 'string' ? content.comparison : undefined;
  if (accepted.length === 0) return { kind: 'short_text', maxWords: DEFAULT_SHORT_TEXT_WORDS };

  const effectiveComparison =
    comparison ?? (inferComparisonMode(accepted) === 'numeric' ? 'numeric' : undefined);
  const shapes = accepted.map((answer) => keyShape(answer, effectiveComparison));
  const primary = shapes[0]!;

  if (primary.kind === 'ordered_tuple') {
    return {
      kind: 'ordered_tuple',
      arity: clamp(primary.components.length, 2, 4),
      componentKind: componentKindOf(primary.components),
    };
  }
  if (primary.kind === 'sequence') {
    return { kind: 'sequence', length: clamp(primary.length, 2, 12) };
  }
  if (isNumberShape(primary)) {
    const numberShapes = shapes.filter(isNumberShape);
    const kinds = new Set(numberShapes.map((shape) => shape.kind));
    const kind: NumberKind =
      primary.kind === 'integer' && kinds.has('decimal') && !kinds.has('fraction')
        ? 'decimal'
        : primary.kind;
    return numberFormat(
      kind,
      numberShapes.filter((shape) => kind !== 'fraction' || shape.kind === 'fraction'),
    );
  }

  const words = Math.max(...shapes.map((shape) => (shape.kind === 'text' ? shape.words : 1)));
  return { kind: 'short_text', maxWords: clamp(words + TEXT_SLACK_WORDS, 1, MAX_TEXT_WORDS) };
}

function freeTextLines(type: ItemType, content: Record<string, unknown>): number {
  const maxWords = typeof content.maxWords === 'number' ? content.maxWords : null;
  if (maxWords !== null && maxWords > 0) {
    return clamp(Math.ceil(maxWords / WORDS_PER_LINE), 2, MAX_FREE_TEXT_LINES);
  }
  return type === 'writing' ? DEFAULT_WRITING_LINES : DEFAULT_FREE_TEXT_LINES;
}

export function resolveResponseFormat(item: ResponseFormatSource): ResponseFormat | null {
  const content =
    item.content !== null && typeof item.content === 'object'
      ? (item.content as Record<string, unknown>)
      : {};

  if (content.responseFormat !== undefined) {
    const declared = responseFormatSchema.safeParse(content.responseFormat);
    if (declared.success) return declared.data;
  }

  switch (item.type) {
    case 'short_answer':
      return shortAnswerFormat(content);
    case 'rubric_scored':
    case 'open_ended':
    case 'writing':
      return { kind: 'free_text', lines: freeTextLines(item.type, content) };
    case 'matching':
    case 'ordering':
      return { kind: 'bubble_choice' };
    default:
      return null;
  }
}
