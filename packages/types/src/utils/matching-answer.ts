// Traduce la respuesta de un ítem de términos pareados tal como viene de una
// hoja de respuestas —una secuencia POSICIONAL de dígitos, "2,5,3,4"— al mapa
// `{ leftId: rightId }` que consume `matchingStrategy`.
//
// Vive acá y no en el importador porque el formato es de la HOJA, no de un
// colegio ni de un instrumento: cualquier ingesta que lea una planilla escaneada
// se topa con la misma secuencia. Sus vecinos `parseSelectedKeys` (multi-select)
// y `parseTrueFalseAnswer` existen por el mismo motivo.
//
// La posición i corresponde al i-ésimo `leftItems`, y el dígito identifica al
// `rightItems` cuyo id termina en ese número. Se resuelve contra los ids reales
// en vez de comparar números sueltos: la estrategia compara `rightId` exacto, y
// derivar el id de un dígito es justamente lo que evita que el importador tenga
// que reimplementar la corrección.

/** Lado izquierdo/derecho de un ítem de pareo, en la forma mínima que se necesita. */
export type MatchingSide = { id: string };

const SEPARATORS = /[,;\s/|]+/;

/** El número final de un id o etiqueta: "A.2" → "2", "B.10" → "10". */
function trailingNumberOf(value: string): string | null {
  const match = /(\d+)\s*$/.exec(value.trim());
  return match ? (match[1] as string) : null;
}

/**
 * Convierte la secuencia posicional en `{ leftId: rightId }`.
 *
 * Las entradas que no resuelven a un `rightItem` (un dígito que no existe, una
 * celda con menos respuestas que pares) se DESCARTAN una a una en vez de anular
 * el ítem completo: con crédito parcial, botar todo por un pareo ilegible le
 * quitaría al alumno los que sí acertó. Devuelve `null` sólo cuando no queda
 * ninguna entrada utilizable, que es lo que quien llama trata como "no respondió".
 */
export function parsePositionalMatchingAnswer(
  raw: unknown,
  leftItems: readonly MatchingSide[],
  rightItems: readonly MatchingSide[],
): Record<string, string> | null {
  if (typeof raw !== 'string') return null;
  const tokens = raw.trim().split(SEPARATORS).filter(Boolean);
  if (tokens.length === 0) return null;

  const rightIdByNumber = new Map<string, string>();
  for (const right of rightItems) {
    const number = trailingNumberOf(right.id);
    if (number !== null && !rightIdByNumber.has(number)) rightIdByNumber.set(number, right.id);
  }

  const pairs: Record<string, string> = {};
  const limit = Math.min(tokens.length, leftItems.length);
  for (let index = 0; index < limit; index++) {
    const left = leftItems[index];
    const number = trailingNumberOf(tokens[index] as string);
    if (!left || number === null) continue;
    const rightId = rightIdByNumber.get(number);
    if (rightId === undefined) continue;
    pairs[left.id] = rightId;
  }

  return Object.keys(pairs).length > 0 ? pairs : null;
}
