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

import type { ItemContent, ItemType, MatchingContent } from '@soe/types';

/** El ítem del instrumento, tal como lo necesita la resolución. */
export interface ResolvableItem {
  position: number;
  type: ItemType;
  content: ItemContent;
  /** Número impreso en el cuadernillo. Se persiste sólo cuando difiere de `position`. */
  printedNumber?: string | null;
}

/** "B.1" / "b1" / " B 1 " → "B1". Normaliza etiquetas para poder cruzarlas. */
function normalizeLabel(label: string): string {
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
  const composites = new Map<number, ItemType>();

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
    composites.set(position, resolved.item.type);
    const existing = byPosition.get(position);
    const bucket =
      existing !== null && typeof existing === 'object' ? existing : ({} as Record<string, string>);
    if (value !== null) bucket[resolved.subKey] = value;
    byPosition.set(position, bucket);
  }

  const unexpectedCompositePositions = Array.from(composites.entries())
    .filter(([, type]) => type !== 'matching')
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

/**
 * Traduce las sub-respuestas de un pareado a `{ leftId: rightId }`.
 *
 * La sub-etiqueta del escaneo identifica el elemento RESPONDIBLE (`leftItems`) y
 * el valor escaneado es la opción elegida (`rightItems`) — ver la invariante de
 * dirección en `matchingContentSchema`. Se cruza por `id`/`label` normalizados y,
 * si el escaneo numera sin rótulo (`9.1`), por posición dentro de `leftItems`.
 */
function resolveMatchingAnswer(
  content: MatchingContent,
  subAnswers: Record<string, string>,
): Record<string, string> {
  const leftItems = content.leftItems ?? [];
  const byLabel = new Map<string, string>();
  leftItems.forEach((el) => {
    byLabel.set(normalizeLabel(el.id), el.id);
    if (el.label) byLabel.set(normalizeLabel(el.label), el.id);
  });

  const resolved: Record<string, string> = {};
  for (const [subKey, value] of Object.entries(subAnswers)) {
    const normalized = normalizeLabel(subKey);
    let leftId = byLabel.get(normalized);

    if (leftId === undefined) {
      const ordinal = Number.parseInt(normalized.replace(/^\D+/, ''), 10);
      const positional = Number.isFinite(ordinal) ? leftItems[ordinal - 1] : undefined;
      leftId = positional?.id;
    }

    if (leftId !== undefined) resolved[leftId] = value;
  }
  return resolved;
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

  const first = Object.values(value).find((v) => v !== null && v !== '');
  return first ?? null;
}
