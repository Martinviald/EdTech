// Normalización de las respuestas de un ítem Verdadero/Falso.
//
// La hoja de respuestas puede escribir el MISMO valor de muchas formas según el
// proveedor y el cuadernillo: `V`/`F`, `VERDADERO`/`FALSO`, `TRUE`/`FALSE`, o las
// letras `A`/`B` cuando el impreso numera las dos opciones como alternativas.
// Todas significan lo mismo y tienen que colapsar al booleano del `content`.
//
// Vive en `packages/types` —y no en la estrategia de scoring— porque la corrección
// y el análisis por ítem tienen que coincidir: si el análisis agrupara distinto
// que el scoring, el % de logro y la distribución de respuestas de una misma
// pregunta se contradirían en pantalla.

const TRUE_ANSWERS = new Set(['TRUE', 'T', 'V', 'VERDADERO', 'SI', 'SÍ', 'YES', '1', 'A']);
const FALSE_ANSWERS = new Set(['FALSE', 'F', 'FALSO', 'NO', '0', 'B']);

/** Claves canónicas con que se expone un V/F en la UI y en la distribución. */
export const TRUE_FALSE_KEYS = { true: 'V', false: 'F' } as const;

export const TRUE_FALSE_LABELS = { V: 'Verdadero', F: 'Falso' } as const;

/**
 * Interpreta la respuesta cruda de un alumno como booleano.
 * Devuelve `null` si no se reconoce — nunca adivina.
 */
export function parseTrueFalseAnswer(raw: unknown): boolean | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toUpperCase();
  if (TRUE_ANSWERS.has(normalized)) return true;
  if (FALSE_ANSWERS.has(normalized)) return false;
  return null;
}

/** Clave canónica (`V`/`F`) de una respuesta cruda, o `null` si no se reconoce. */
export function trueFalseKeyOf(raw: unknown): 'V' | 'F' | null {
  const parsed = parseTrueFalseAnswer(raw);
  if (parsed === null) return null;
  return parsed ? TRUE_FALSE_KEYS.true : TRUE_FALSE_KEYS.false;
}

/**
 * ¿El `content` de este ítem es el de un Verdadero/Falso canónico? Se decide por
 * el dato (`correctAnswer` booleano), no por el `type`, para que sirva también
 * donde sólo se tiene el JSONB a mano.
 */
export function isTrueFalseContent(content: unknown): content is { correctAnswer: boolean } {
  return (
    content !== null &&
    typeof content === 'object' &&
    typeof (content as { correctAnswer?: unknown }).correctAnswer === 'boolean'
  );
}
