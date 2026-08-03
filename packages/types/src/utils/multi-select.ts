// Parseo de la respuesta de un ítem de multi-selección.
//
// La hoja escanea el conjunto marcado y cada proveedor lo escribe distinto:
// GradeCam lo concatena (`"145"`), otros usan separadores (`"1,4,5"`, `"1 4 5"`)
// y una ingesta programática puede mandar un array. Todas significan lo mismo.
//
// Vive en `packages/types` por el mismo motivo que la normalización de V/F: la
// corrección y el análisis por ítem tienen que interpretar la respuesta IGUAL,
// o el % de logro y la distribución de la misma pregunta se contradicen.

/**
 * Interpreta la respuesta cruda como un conjunto de keys de alternativa.
 *
 * `validKeys` son las keys declaradas en el `content`; se usan para desambiguar
 * la forma concatenada. Devuelve `null` cuando NO se puede interpretar sin
 * adivinar — por ejemplo `"145"` cuando alguna key tiene más de un carácter,
 * donde no hay forma de saber si son `1,4,5` o `14,5`.
 */
export function parseSelectedKeys(raw: unknown, validKeys: readonly string[]): Set<string> | null {
  const known = new Set(validKeys.map((k) => k.trim().toUpperCase()));

  if (Array.isArray(raw)) {
    const out = new Set<string>();
    for (const value of raw) {
      if (typeof value !== 'string') return null;
      const key = value.trim().toUpperCase();
      if (key.length > 0) out.add(key);
    }
    return out;
  }

  if (typeof raw !== 'string') return null;
  const text = raw.trim().toUpperCase();
  if (text.length === 0) return new Set();

  // Forma con separadores: es inequívoca, se respeta tal cual.
  if (/[,;\s/|+-]/.test(text)) {
    const out = new Set<string>();
    for (const part of text.split(/[,;\s/|+-]+/)) {
      const key = part.trim();
      if (key.length > 0) out.add(key);
    }
    return out;
  }

  // Forma concatenada (`"145"`): sólo se puede partir carácter a carácter si
  // TODAS las keys declaradas son de un carácter. Si no, es ambiguo.
  if (known.size > 0 && [...known].every((k) => k.length === 1)) {
    const out = new Set<string>();
    for (const char of text) out.add(char);
    return out;
  }

  // Una sola key declarada que calza entera (multi-selección con una marca).
  if (known.has(text)) return new Set([text]);

  return null;
}

/** Keys correctas declaradas en un content con alternativas. */
export function correctKeysOf(
  alternatives: readonly { key: string; isCorrect?: boolean }[],
): Set<string> {
  return new Set(
    alternatives.filter((alt) => alt.isCorrect === true).map((alt) => alt.key.trim().toUpperCase()),
  );
}

/** ¿Los dos conjuntos tienen exactamente los mismos elementos? */
export function sameKeySet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

/**
 * ¿El `content` es de multi-selección? Se decide por el DATO —dos o más
 * alternativas correctas— y no por el `type`, para poder detectar los ítems que
 * la extracción tipó mal.
 */
export function hasMultipleCorrectAlternatives(content: unknown): boolean {
  if (content === null || typeof content !== 'object') return false;
  const alternatives = (content as { alternatives?: unknown }).alternatives;
  if (!Array.isArray(alternatives)) return false;
  const correct = alternatives.filter(
    (alt) =>
      alt !== null &&
      typeof alt === 'object' &&
      (alt as { isCorrect?: unknown }).isCorrect === true,
  );
  return correct.length >= 2 && correct.length < alternatives.length;
}
