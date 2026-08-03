// Resolución de las respuestas COMPUESTAS que trae un escaneo: varias
// sub-columnas (`7B1`, `7B2`, … o `9.1`, `9.2`, …) para una sola pregunta
// impresa. El parser las agrupa por posición sin interpretarlas (no conoce los
// tipos de ítem); acá se traducen a la forma que espera la estrategia de
// corrección de cada tipo.
//
// Es deliberadamente agnóstico del proveedor y del instrumento: la regla es
// "un ítem compuesto se resuelve según su tipo", no "GradeCam escribe 7B1".

import type { ItemContent, ItemType, MatchingContent } from '@soe/types';
import type { ParsedAnswerValue } from './parsers/parser.types';

/** "B.1" / "b1" / " B 1 " → "B1". Permite cruzar la sub-etiqueta del escaneo con el id del content. */
function normalizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
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
 * Colapsa una respuesta compuesta a lo que espera la estrategia del `type`.
 * Los tipos que no son compuestos por naturaleza se quedan con la primera
 * sub-respuesta no vacía: es un dato inesperado, pero perder la respuesta
 * entera es peor que quedarse con una (antes se perdían TODAS menos la última,
 * en silencio).
 */
export function resolveCompositeAnswer(
  item: { type: ItemType; content: ItemContent },
  value: ParsedAnswerValue,
): unknown {
  if (value === null || typeof value !== 'object') return value;

  if (item.type === 'matching') {
    return resolveMatchingAnswer(item.content as MatchingContent, value);
  }

  const first = Object.values(value).find((v) => v !== null && v !== '');
  return first ?? null;
}

/**
 * ¿Esta respuesta compuesta corresponde a un ítem que la app modela como uno
 * solo? Se usa para avisar en el preview cuando el escaneo sub-numera un ítem
 * que NO es compuesto — el caso que hoy se traga en silencio.
 */
export function isUnexpectedCompositeAnswer(
  item: { type: ItemType } | undefined,
  value: ParsedAnswerValue,
): boolean {
  if (value === null || typeof value !== 'object') return false;
  return item?.type !== 'matching';
}
