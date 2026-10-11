import {
  responseFormatSchema,
  type ResponseFormat,
} from '../schemas/answer-reading/response-format.schema';
import type { ItemType } from '../enums';
import { inferComparisonMode } from './short-answer';

// Formato de respuesta de un ítem (diseño §5.3). Si el ítem lo declara en
// `content.responseFormat`, manda ese. Si no, se deduce del tipo y de la pauta:
// la clave dice cómo se escribe la respuesta (`21/10` es fracción, `(7;3)` par
// ordenado, `3-1-4-2` secuencia, `Cabeza, tórax, abdomen` lista de palabras) y un
// `gap_fill` con dos o más casillas es `multi_box`. `null` = el ítem no tiene un
// formato que la hoja sepa imprimir.

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
const MAX_WORD_LIST_COUNT = 10;
const MAX_WORDS_PER_LIST_ENTRY = 3;
const MIN_ENTRIES_FOR_MULTIWORD_LIST = 3;

const INTEGER = /^[+-]?\d+$/;
const DECIMAL = /^[+-]?\d*[.,]\d+$/;
const FRACTION = /^[+-]?\d+\s*\/\s*\d+$/;
const MIXED_FRACTION = /^[+-]?\d+\s+\d+\s*\/\s*\d+$/;
const PARENTHESIZED = /^\((.+)\)$/;
const DASHED_SEQUENCE = /^\d+(\s*[-–]\s*\d+)+$/;
const COMMA_SEQUENCE = /^\d+(\s*[,;]\s*\d+){2,}$/;
const LIST_ENTRY = /^[\p{L}'’-]+(?: [\p{L}'’-]+)*$/u;

type NumberKind = 'integer' | 'decimal' | 'fraction';
type KeyShape =
  | { kind: NumberKind; negative: boolean; mixed: boolean; length: number }
  | { kind: 'ordered_tuple'; components: string[] }
  | { kind: 'sequence'; length: number }
  | { kind: 'word_list'; count: number }
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

  const entries = wordListEntries(key);
  if (entries !== null) return { kind: 'word_list', count: entries.length };
  return { kind: 'text', words: key.split(' ').filter(Boolean).length };
}

/**
 * Entradas de una clave que es una lista de palabras separadas por coma o punto y
 * coma: dos o más palabras sueltas, o tres o más entradas de hasta tres palabras.
 * Una oración con coma (`Sí, porque llueve`) no es lista. `null` si no es lista.
 */
function wordListEntries(key: string): string[] | null {
  if (!/[,;]/.test(key)) return null;
  const entries = key
    .replace(/[.]$/, '')
    .split(/[,;]|\s(?:y|e)\s/i)
    .map((entry) => entry.trim());
  if (entries.length < 2 || entries.some((entry) => !LIST_ENTRY.test(entry))) return null;
  const sizes = entries.map((entry) => entry.split(' ').length);
  if (sizes.every((size) => size === 1)) return entries;
  const multiwordOk =
    entries.length >= MIN_ENTRIES_FOR_MULTIWORD_LIST &&
    sizes.every((size) => size <= MAX_WORDS_PER_LIST_ENTRY);
  return multiwordOk ? entries : null;
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
  if (primary.kind === 'word_list') {
    const counts = shapes.map((shape) => (shape.kind === 'word_list' ? shape.count : 1));
    return { kind: 'word_list', count: clamp(Math.max(...counts), 1, MAX_WORD_LIST_COUNT) };
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

  const words = Math.max(
    ...shapes.map((shape) =>
      shape.kind === 'text' ? shape.words : shape.kind === 'word_list' ? shape.count : 1,
    ),
  );
  return { kind: 'short_text', maxWords: clamp(words + TEXT_SLACK_WORDS, 1, MAX_TEXT_WORDS) };
}

type BoxKind = Extract<ResponseFormat, { kind: 'multi_box' }>['boxes'][number]['kind'];

function boxKindOf(gap: Record<string, unknown>): BoxKind {
  const textual = ['text', 'short_text', 'word_list'];
  if (typeof gap.comparison === 'string' && textual.includes(gap.comparison)) return 'short_text';
  const accepted = Array.isArray(gap.acceptedAnswers)
    ? gap.acceptedAnswers.filter((answer): answer is string => typeof answer === 'string')
    : [];
  const shapes = accepted.map((answer) => numberShape(answer.trim().replace(/\s+/g, ' ')));
  if (shapes.length === 0 || shapes.some((shape) => shape === null)) return 'short_text';
  const kinds = new Set(shapes.map((shape) => shape?.kind));
  if (kinds.has('fraction')) return 'fraction';
  return kinds.has('decimal') ? 'decimal' : 'integer';
}

/** `gap_fill` con dos o más casillas: una casilla por gap, con su tipo según la clave. */
function multiBoxFormat(content: Record<string, unknown>): ResponseFormat | null {
  const gaps = Array.isArray(content.gaps)
    ? content.gaps.filter(
        (gap): gap is Record<string, unknown> => gap !== null && typeof gap === 'object',
      )
    : [];
  if (gaps.length < 2) return null;
  const boxes = gaps.map((gap, index) => ({
    partId:
      typeof gap.partId === 'string' && gap.partId.length > 0
        ? gap.partId
        : String(typeof gap.position === 'number' ? gap.position : index),
    label:
      typeof gap.label === 'string' && gap.label.length > 0 ? gap.label : `Casilla ${index + 1}`,
    kind: boxKindOf(gap),
  }));
  if (new Set(boxes.map((box) => box.partId)).size !== boxes.length) return null;
  const parsed = responseFormatSchema.safeParse({ kind: 'multi_box', boxes });
  return parsed.success ? parsed.data : null;
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
    case 'gap_fill':
      return multiBoxFormat(content);
    default:
      return null;
  }
}
