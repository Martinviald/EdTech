// Resolución de las respuestas de un escaneo contra los ítems del instrumento.
//
// El escaneo numera por el NÚMERO IMPRESO en el cuadernillo; la BDD indexa por
// `position`, y los dos NO coinciden cuando el cuadernillo sub-numera: Ciencias
// 8° 2026 imprime `1..13, 14.1..14.5, 15.1..15.4, …` sobre 43 posiciones
// correlativas — 30 de sus 43 ítems tienen `position ≠ printedNumber`. Resolver
// por `position` desalinea el instrumento entero.
//
// Dos formas distintas de sub-numeración, que hay que distinguir:
//
//   a) el cuadernillo sub-numera y la extracción separó cada sub-pregunta en su
//      propio ítem  → `14.2` ES un ítem, con su propio `printedNumber`;
//   b) el cuadernillo sub-numera UNA pregunta que la app modela como un solo
//      ítem compuesto → `7B1..7B4` son sub-respuestas de un pareado.
//
// Se distinguen mirando el instrumento, no la forma de la etiqueta: primero se
// busca la etiqueta COMPLETA entre los números impresos; sólo si no existe se la
// parte en base + sub-etiqueta. Sin ese orden, `14.2` se leería como
// sub-respuesta de la pregunta 14 y se perderían 4 de cada 5 respuestas.

import {
  resolveResponseFormat,
  type ItemContent,
  type ItemType,
  type MatchingContent,
  type OrderingContent,
} from '@soe/types';
import type { PrescoredAnswer } from './parsers/parser.types';

/** El ítem del instrumento, tal como lo necesita la resolución. */
export interface ResolvableItem {
  id?: string;
  position: number;
  type: ItemType;
  content: ItemContent;
  /** Número impreso en el cuadernillo. Se persiste sólo cuando difiere de `position`. */
  printedNumber?: string | null;
}

/** "B.1" / "b1" / " B 1 " → "B1". Normaliza etiquetas para poder cruzarlas. */
export function normalizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/**
 * Índice etiqueta impresa → ítem. Un ítem se indexa por su `printedNumber` y
 * también por su `position`: los instrumentos sin sub-numeración no persisten
 * `printedNumber` (es igual a la posición) y el escaneo igual debe resolver.
 */
export function buildPrintedLabelIndex(
  items: readonly ResolvableItem[],
): Map<string, ResolvableItem> {
  const index = new Map<string, ResolvableItem>();
  for (const item of items) {
    index.set(normalizeLabel(String(item.position)), item);
  }
  // Los printedNumber se aplican DESPUÉS y pisan: cuando ambos existen para la
  // misma etiqueta, el impreso es el que usa la hoja de respuestas.
  for (const item of items) {
    if (item.printedNumber) index.set(normalizeLabel(item.printedNumber), item);
  }
  return index;
}

/** Parte una etiqueta en su base numérica y el resto: "7B1" → ["7", "B1"]. */
function splitLabel(label: string): { base: string; subKey: string } | null {
  const m = label.trim().match(/^[^\d]*(\d+)(.+)$/);
  if (!m || !m[1] || !m[2]) return null;
  const rest = m[2]
    .trim()
    .replace(/^[.\-_:]+/, '')
    .trim();
  if (rest.length === 0) return null;
  return { base: m[1], subKey: rest };
}

export type ResolvedAnswer =
  | { kind: 'item'; item: ResolvableItem; value: string | null }
  | { kind: 'sub'; item: ResolvableItem; subKey: string; value: string | null }
  | { kind: 'unmatched'; label: string; value: string | null };

/**
 * Resuelve UNA columna del escaneo contra el instrumento. Exact-first: la
 * etiqueta completa gana sobre la interpretación de sub-pregunta.
 */
export function resolveScanLabel(
  index: Map<string, ResolvableItem>,
  label: string,
  value: string | null,
): ResolvedAnswer {
  const exact = index.get(normalizeLabel(label));
  if (exact) return { kind: 'item', item: exact, value };

  const split = splitLabel(label);
  if (split) {
    const base = index.get(normalizeLabel(split.base));
    if (base) return { kind: 'sub', item: base, subKey: split.subKey, value };
  }

  return { kind: 'unmatched', label, value };
}

/** Respuesta cruda de un ítem: un valor simple o las sub-respuestas agrupadas. */
export type RawItemAnswer = string | null | Record<string, string>;

export interface ResolvedRow {
  /** position → respuesta cruda del alumno, ya agrupada. */
  byPosition: Map<number, RawItemAnswer>;
  /** Etiquetas del escaneo que no corresponden a ningún ítem del instrumento. */
  unmatchedLabels: string[];
  /** Posiciones que recibieron sub-respuestas sin ser un ítem compuesto. */
  unexpectedCompositePositions: number[];
}

/** Resuelve todas las columnas de una fila del escaneo contra el instrumento. */
export function resolveRowAnswers(
  index: Map<string, ResolvableItem>,
  answers: Record<string, string | null>,
): ResolvedRow {
  const byPosition = new Map<number, RawItemAnswer>();
  const unmatchedLabels: string[] = [];
  const composites = new Map<number, ResolvableItem>();

  for (const [label, value] of Object.entries(answers)) {
    const resolved = resolveScanLabel(index, label, value);

    if (resolved.kind === 'unmatched') {
      if (value !== null) unmatchedLabels.push(resolved.label);
      continue;
    }

    if (resolved.kind === 'item') {
      byPosition.set(resolved.item.position, value);
      continue;
    }

    const position = resolved.item.position;
    composites.set(position, resolved.item);
    const existing = byPosition.get(position);
    const bucket =
      existing !== null && typeof existing === 'object' ? existing : ({} as Record<string, string>);
    if (value !== null) bucket[resolved.subKey] = value;
    byPosition.set(position, bucket);
  }

  const unexpectedCompositePositions = Array.from(composites.entries())
    .filter(([, item]) => !acceptsCompositeAnswer(item))
    .map(([position]) => position);

  return { byPosition, unmatchedLabels, unexpectedCompositePositions };
}

export interface AnnulledAnswers {
  wholePositions: Set<number>;
  subKeysByPosition: Map<number, Set<string>>;
}

export function resolveAnnulledAnswers(
  index: Map<string, ResolvableItem>,
  annulledLabels: readonly string[] | undefined,
): AnnulledAnswers {
  const wholePositions = new Set<number>();
  const subKeysByPosition = new Map<number, Set<string>>();

  for (const label of annulledLabels ?? []) {
    const resolved = resolveScanLabel(index, label, null);
    if (resolved.kind === 'item') {
      wholePositions.add(resolved.item.position);
      continue;
    }
    if (resolved.kind === 'sub') {
      const keys = subKeysByPosition.get(resolved.item.position) ?? new Set<string>();
      keys.add(resolved.subKey);
      subKeysByPosition.set(resolved.item.position, keys);
    }
  }

  return { wholePositions, subKeysByPosition };
}

export function annulmentEvidence(
  annulled: AnnulledAnswers,
  position: number,
): { annulled: true } | { annulledParts: string[] } | null {
  if (annulled.wholePositions.has(position)) return { annulled: true };
  const keys = annulled.subKeysByPosition.get(position);
  if (keys === undefined || keys.size === 0) return null;
  return { annulledParts: [...keys].sort() };
}

export function resolvePendingReadingPositions(
  index: Map<string, ResolvableItem>,
  pendingReadingLabels: readonly string[] | undefined,
): Set<number> {
  const positions = new Set<number>();
  for (const label of pendingReadingLabels ?? []) {
    const resolved = resolveScanLabel(index, label, null);
    if (resolved.kind !== 'unmatched') positions.add(resolved.item.position);
  }
  return positions;
}

export interface ResolvedPrescoredAnswers {
  byPosition: Map<number, PrescoredAnswer>;
  pendingPositions: Set<number>;
}

export function resolvePrescoredAnswers(
  index: Map<string, ResolvableItem>,
  prescoredAnswers: Readonly<Record<string, PrescoredAnswer>> | undefined,
): ResolvedPrescoredAnswers {
  const byPosition = new Map<number, PrescoredAnswer>();
  const pendingPositions = new Set<number>();
  for (const [label, prescored] of Object.entries(prescoredAnswers ?? {})) {
    const resolved = resolveScanLabel(index, label, null);
    if (resolved.kind === 'unmatched') continue;
    const position = resolved.item.position;
    const usable =
      resolved.kind === 'item' &&
      resolved.item.id === prescored.itemId &&
      !byPosition.has(position);
    if (usable && !pendingPositions.has(position)) {
      byPosition.set(position, prescored);
      continue;
    }
    byPosition.delete(position);
    pendingPositions.add(position);
  }
  return { byPosition, pendingPositions };
}

export interface BubbleChoiceOption {
  value: string;
  id: string;
}

export interface BubbleChoiceRow {
  subKey: string;
  values: string[];
}

export type BubbleChoicePlan = { rows: BubbleChoiceRow[] } | { reason: string };

interface ChoiceElement {
  id: string;
  label?: string;
}

const MAX_BUBBLE_VALUE_LENGTH = 2;
const SEQUENCE_TOKEN_SEPARATORS = /[\s,;\-–/|]+/;
const OPTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function isBubbleChoiceSequence(item: { type: ItemType; content: ItemContent }): boolean {
  return (
    item.type === 'short_answer' &&
    resolveResponseFormat({ type: item.type, content: item.content })?.kind === 'bubble_choice'
  );
}

function acceptsCompositeAnswer(item: ResolvableItem): boolean {
  return item.type === 'matching' || item.type === 'ordering' || isBubbleChoiceSequence(item);
}

function shortCodeOf(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = normalizeLabel(value);
  return normalized.length > 0 && normalized.length <= MAX_BUBBLE_VALUE_LENGTH ? normalized : null;
}

function translateOption(options: readonly BubbleChoiceOption[], raw: string): string {
  const trimmed = raw.trim();
  for (const option of options) {
    if (option.id === trimmed) return option.id;
  }
  const normalized = normalizeLabel(trimmed);
  for (const option of options) {
    if (option.value === normalized) return option.id;
  }
  return trimmed;
}

function optionsRoundTrip(options: readonly BubbleChoiceOption[]): boolean {
  const values = new Set(options.map((option) => option.value));
  if (values.size !== options.length) return false;
  return options.every((option) => translateOption(options, option.value) === option.id);
}

export function bubbleChoiceOptions(
  elements: readonly ChoiceElement[],
): BubbleChoiceOption[] | null {
  const schemes: ((element: ChoiceElement, index: number) => string | null)[] = [
    (element) => shortCodeOf(element.label) ?? shortCodeOf(element.id),
    (element) => shortCodeOf(element.id) ?? shortCodeOf(element.label),
    (_, index) => OPTION_LETTERS[index] ?? null,
  ];
  for (const scheme of schemes) {
    const options: BubbleChoiceOption[] = [];
    for (const [index, element] of elements.entries()) {
      const value = scheme(element, index);
      if (value === null) break;
      options.push({ value, id: element.id });
    }
    if (options.length === elements.length && optionsRoundTrip(options)) return options;
  }
  return null;
}

function choiceElementsOf(raw: unknown): ChoiceElement[] {
  if (!Array.isArray(raw)) return [];
  const elements: ChoiceElement[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const { id, label } = entry as { id?: unknown; label?: unknown };
    if (typeof id !== 'string' || id.length === 0) continue;
    elements.push(typeof label === 'string' ? { id, label } : { id });
  }
  return elements;
}

export function matchingLeftIdForSubKey(
  content: MatchingContent,
  subKey: string,
): string | undefined {
  const leftItems = content.leftItems ?? [];
  const byLabel = new Map<string, string>();
  leftItems.forEach((el) => {
    byLabel.set(normalizeLabel(el.id), el.id);
    if (el.label) byLabel.set(normalizeLabel(el.label), el.id);
  });

  const normalized = normalizeLabel(subKey);
  const leftId = byLabel.get(normalized);
  if (leftId !== undefined) return leftId;

  const ordinal = Number.parseInt(normalized.replace(/^\D+/, ''), 10);
  return Number.isFinite(ordinal) ? leftItems[ordinal - 1]?.id : undefined;
}

function sequenceTokensOf(content: ItemContent): string[] {
  const accepted = (content as { acceptedAnswers?: unknown }).acceptedAnswers;
  const first = Array.isArray(accepted) ? accepted.find((key) => typeof key === 'string') : null;
  if (typeof first !== 'string') return [];
  return first.trim().split(SEQUENCE_TOKEN_SEPARATORS).filter(Boolean);
}

function sequenceOptionValues(tokens: readonly string[]): string[] {
  const unique = Array.from(new Set(tokens.map(normalizeLabel)));
  const numeric = unique.every((token) => /^\d+$/.test(token));
  return unique.sort((a, b) => (numeric ? Number(a) - Number(b) : a.localeCompare(b)));
}

function positionRows(count: number, values: string[]): BubbleChoiceRow[] {
  return Array.from({ length: count }, (_, index) => ({ subKey: String(index + 1), values }));
}

function matchingPlan(content: MatchingContent, maxOptions: number): BubbleChoicePlan {
  const left = choiceElementsOf(content.leftItems);
  const right = choiceElementsOf(content.rightItems);
  if (left.length === 0 || right.length < 2) {
    return { reason: 'El pareado no tiene términos ni opciones suficientes para dibujar burbujas' };
  }
  if (right.length > maxOptions) {
    return {
      reason: `El pareado tiene ${right.length} opciones y el máximo imprimible por fila es ${maxOptions}`,
    };
  }
  const options = bubbleChoiceOptions(right);
  if (options === null) {
    return {
      reason: 'Las opciones del pareado no tienen un rótulo corto e inequívoco para la burbuja',
    };
  }
  const values = options.map((option) => option.value);
  const rows: BubbleChoiceRow[] = [];
  for (const [index, element] of left.entries()) {
    const candidates = [element.label, String(index + 1), element.id]
      .filter((candidate): candidate is string => candidate !== undefined)
      .map(normalizeLabel)
      .filter((candidate) => candidate.length > 0);
    const subKey = candidates.find(
      (candidate) => matchingLeftIdForSubKey(content, candidate) === element.id,
    );
    if (subKey === undefined) {
      return { reason: `El término "${element.id}" del pareado no tiene una etiqueta inequívoca` };
    }
    rows.push({ subKey, values });
  }
  return { rows };
}

function orderingPlan(content: OrderingContent, maxOptions: number): BubbleChoicePlan {
  const elements = choiceElementsOf(content.items);
  if (elements.length < 2) {
    return { reason: 'El ordenamiento no tiene elementos suficientes para dibujar burbujas' };
  }
  if (elements.length > maxOptions) {
    return {
      reason: `El ordenamiento tiene ${elements.length} elementos y el máximo imprimible por fila es ${maxOptions}`,
    };
  }
  const options = bubbleChoiceOptions(elements);
  if (options === null) {
    return { reason: 'Los elementos del ordenamiento no tienen un rótulo corto e inequívoco' };
  }
  return {
    rows: positionRows(
      elements.length,
      options.map((option) => option.value),
    ),
  };
}

function sequencePlan(content: ItemContent, maxOptions: number): BubbleChoicePlan {
  const tokens = sequenceTokensOf(content);
  if (tokens.length < 2) {
    return { reason: 'La clave de la secuencia no tiene al menos dos elementos' };
  }
  const values = sequenceOptionValues(tokens);
  if (values.some((value) => value.length === 0 || value.length > MAX_BUBBLE_VALUE_LENGTH)) {
    return { reason: 'Los elementos de la secuencia no caben en una burbuja' };
  }
  if (values.length > maxOptions) {
    return {
      reason: `La secuencia usa ${values.length} elementos distintos y el máximo imprimible por fila es ${maxOptions}`,
    };
  }
  return { rows: positionRows(tokens.length, values) };
}

export function planBubbleChoice(
  item: { type: ItemType; content: ItemContent },
  maxOptions: number,
): BubbleChoicePlan {
  if (item.type === 'matching') {
    return matchingPlan(item.content as MatchingContent, maxOptions);
  }
  if (item.type === 'ordering') {
    return orderingPlan(item.content as OrderingContent, maxOptions);
  }
  if (isBubbleChoiceSequence(item)) return sequencePlan(item.content, maxOptions);
  return {
    reason: `Las burbujas por fila (bubble_choice) solo aplican a pareados, ordenamientos y secuencias, no a "${item.type}"`,
  };
}

function resolveMatchingAnswer(
  content: MatchingContent,
  subAnswers: Record<string, string>,
): Record<string, string> {
  const options = bubbleChoiceOptions(choiceElementsOf(content.rightItems)) ?? [];
  const resolved: Record<string, string> = {};
  for (const [subKey, value] of Object.entries(subAnswers)) {
    const leftId = matchingLeftIdForSubKey(content, subKey);
    if (leftId !== undefined) resolved[leftId] = translateOption(options, value);
  }
  return resolved;
}

function valuesByPosition(subAnswers: Record<string, string>): string[] | null {
  const byPosition = new Map<number, string>();
  let last = 0;
  for (const [subKey, value] of Object.entries(subAnswers)) {
    const position = Number.parseInt(normalizeLabel(subKey), 10);
    if (!Number.isInteger(position) || position < 1 || value.trim().length === 0) continue;
    byPosition.set(position, value.trim());
    last = Math.max(last, position);
  }
  if (byPosition.size === 0) return null;
  return Array.from({ length: last }, (_, index) => byPosition.get(index + 1) ?? '');
}

function resolveOrderingAnswer(
  content: OrderingContent,
  subAnswers: Record<string, string>,
): string[] | null {
  const positions = valuesByPosition(subAnswers);
  if (positions === null) return null;
  const options = bubbleChoiceOptions(choiceElementsOf(content.items)) ?? [];
  return positions.map((value) => (value === '' ? '' : translateOption(options, value)));
}

function resolveSequenceAnswer(subAnswers: Record<string, string>): string | null {
  const positions = valuesByPosition(subAnswers);
  return positions === null ? null : positions.join('-');
}

/**
 * Colapsa la respuesta cruda de un ítem a lo que espera la estrategia de su
 * `type`. Los tipos que no son compuestos se quedan con la primera sub-respuesta
 * no vacía: es un dato inesperado, pero perder la respuesta entera es peor que
 * quedarse con una (antes se perdían TODAS menos la última, en silencio).
 */
export function toScoringAnswer(
  item: { type: ItemType; content: ItemContent },
  value: RawItemAnswer | undefined,
): unknown {
  if (value === undefined || value === null || typeof value !== 'object') return value ?? null;

  if (item.type === 'matching') {
    return resolveMatchingAnswer(item.content as MatchingContent, value);
  }
  if (item.type === 'ordering') {
    return resolveOrderingAnswer(item.content as OrderingContent, value);
  }
  if (isBubbleChoiceSequence(item)) return resolveSequenceAnswer(value);

  const first = Object.values(value).find((v) => v !== null && v !== '');
  return first ?? null;
}
