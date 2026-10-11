// Comparación de una respuesta corta escrita contra las claves de la pauta.
//
// Vive en `packages/types` por el mismo motivo que `multi-select` y `true-false`:
// la corrección y el análisis por ítem tienen que interpretar la respuesta IGUAL,
// o el % de logro y la distribución de la misma pregunta se contradicen.
//
// El criterio, tomado de las respuestas reales digitalizadas:
//   · se tolera la FORMA (separador decimal, espacios, fracción equivalente, la
//     unidad declarada) — el alumno no debe perder puntaje por cómo se escribió;
//   · se marca incorrecto lo que es otra cantidad (`56` cuando la clave es `5,6`);
//   · se marca INDECIDIBLE lo que trae más de un valor candidato (`0=16.5`, `1 4`)
//     o lo que admite dos lecturas con resultados distintos (`1.500`: ¿1500 o 1,5?)
//     — ahí no se puede saber qué respondió, y adivinar sería inventar un dato.
//
// La clave y la respuesta se convierten a la MISMA estructura canónica antes de
// compararse (`answer-canonical`, diseño §5.5).

import type {
  ComponentCredit,
  Equivalences,
  ResponseFormatKind,
} from '../schemas/answer-reading/response-format.schema';
import {
  compareCanonical,
  isParsed,
  parseOrderedTupleText,
  parseScalarText,
  parseSequenceText,
  type CanonicalComparison,
  type CanonicalParse,
  type CanonicalSequence,
  type CanonicalTuple,
} from './answer-canonical';

/** Resultado de comparar una respuesta contra las claves aceptadas. */
export type ShortAnswerMatch = 'match' | 'mismatch' | 'undecidable';

/**
 * Modo de comparación. `numeric` y `text` comparan UN valor; `sequence` compara un
 * orden (`3-1-4-2`); `ordered_tuple` un par o terna ordenada (`(7;3)`).
 */
export type ShortAnswerComparison = 'numeric' | 'text' | 'sequence' | 'ordered_tuple';

export type ShortAnswerOptions = {
  comparison?: ShortAnswerComparison;
  unit?: string;
  caseSensitive?: boolean;
  /** Formato declarado del ítem (`content.responseFormat.kind`); ajusta las equivalencias. */
  formatKind?: ResponseFormatKind;
  /** Equivalencias de la pauta (`scoring_config.equivalences`). */
  equivalences?: Equivalences;
  /** Crédito por componente en pares ordenados (`scoring_config.componentCredit`). */
  componentCredit?: ComponentCredit;
};

/** Comparación con crédito: `partial` solo existe en pares con `componentCredit`. */
export type ShortAnswerCredit = CanonicalComparison;

const INCORRECT: ShortAnswerCredit = { outcome: 'incorrect', credit: 0 };
const UNDECIDABLE: ShortAnswerCredit = { outcome: 'undecidable', credit: 0 };
const EXPLICIT_TUPLE = /^\s*[([{].*[)\]}]\s*$|[;#]/;

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function stripUnit(value: string, unit: string | undefined): string {
  if (!unit) return value;
  const normalized = value.toLowerCase();
  const suffix = unit.trim().toLowerCase();
  if (!suffix || !normalized.endsWith(suffix)) return value;
  return value.slice(0, value.length - suffix.length).trim();
}

/**
 * Un valor que no se pudo leer como número es indecidible cuando contiene más de
 * un número candidato: `0=16.5`, `1 4`, `2,5-2`.
 */
function hasSeveralValues(value: string): boolean {
  const tightened = value.replace(/\s*\/\s*/g, '/');
  const tokens = tightened.split(/[\s=;|]+/).filter(Boolean);
  if (tokens.length > 1 && tokens.filter((t) => /\d/.test(t)).length > 1) return true;
  return /\d\s*[-+*][\s]*\d/.test(tightened) && !/^[+-]?\d+\/\d+$/.test(tightened);
}

function looksNumeric(value: string): boolean {
  return isParsed(parseScalarText(value));
}

function looksLikeTuple(value: string): boolean {
  return EXPLICIT_TUPLE.test(value) && isParsed(parseOrderedTupleText(value));
}

/** Deriva el modo de comparación cuando el ítem no lo declara. */
export function inferComparisonMode(
  accepted: readonly string[],
): Exclude<ShortAnswerComparison, 'sequence'> {
  const cleaned = accepted.map((a) => collapseWhitespace(a)).filter(Boolean);
  if (cleaned.length === 0) return 'text';
  if (cleaned.every(looksNumeric)) return 'numeric';
  if (cleaned.every(looksLikeTuple)) return 'ordered_tuple';
  return 'text';
}

function firstElements(parse: CanonicalParse<CanonicalSequence>): string[] {
  return parse.readings.decimal[0]?.elements ?? [];
}

function tupleArity(parse: CanonicalParse<CanonicalTuple>): number | null {
  const lengths = new Set(
    [...parse.readings.decimal, ...parse.readings.thousands].map((t) => t.components.length),
  );
  return lengths.size === 1 ? ([...lengths][0] ?? null) : null;
}

function bestOf(results: ShortAnswerCredit[]): ShortAnswerCredit {
  if (results.some((r) => r.outcome === 'undecidable')) {
    return results.some((r) => r.outcome === 'correct')
      ? { outcome: 'correct', credit: 1 }
      : UNDECIDABLE;
  }
  return results.reduce<ShortAnswerCredit>(
    (top, r) =>
      r.outcome === 'correct' || (top.outcome !== 'correct' && r.credit > top.credit) ? r : top,
    INCORRECT,
  );
}

function compareSequence(
  answer: string,
  keys: string[],
  options: ShortAnswerOptions,
): ShortAnswerCredit {
  const parsedKeys = keys.map((key) => parseSequenceText(key)).filter(isParsed);
  if (parsedKeys.length === 0) return INCORRECT;
  return bestOf(
    parsedKeys.map((key) => {
      const elements = firstElements(key);
      // Un escáner pega las casillas de un orden (`3142`): se separa sólo si la
      // clave es un orden de 3+ elementos de un carácter y trae esa cantidad.
      // Un par (`56` contra `(5,6)`) no: podría ser el número 56.
      const given = parseSequenceText(answer, {
        expectedLength: elements.length,
        allowPasted: elements.length >= 3 && elements.every((e) => [...e].length === 1),
      });
      if (!isParsed(given)) return INCORRECT;
      return compareCanonical(given, [key], options.formatKind ?? null, options.equivalences);
    }),
  );
}

/** Respaldo para un par sin separador reconocible (`7-3`): un token por componente. */
function tupleFromTokens(answer: string, arity: number): CanonicalParse<CanonicalTuple> | null {
  const tokens = firstElements(parseSequenceText(answer));
  return tokens.length === arity ? parseOrderedTupleText(`(${tokens.join(';')})`, arity) : null;
}

function compareTuple(
  answer: string,
  keys: string[],
  options: ShortAnswerOptions,
): ShortAnswerCredit {
  const parsedKeys = keys.map((key) => parseOrderedTupleText(key)).filter(isParsed);
  if (parsedKeys.length === 0) return UNDECIDABLE;
  return bestOf(
    parsedKeys.map((key) => {
      const arity = tupleArity(key) ?? undefined;
      const direct = parseOrderedTupleText(answer, arity);
      const given =
        isParsed(direct) || arity === undefined ? direct : tupleFromTokens(answer, arity);
      if (given === null || !isParsed(given)) return INCORRECT;
      return compareCanonical(
        given,
        [key],
        options.formatKind ?? null,
        options.equivalences,
        options.componentCredit,
      );
    }),
  );
}

function compareNumeric(
  answer: string,
  keys: string[],
  options: ShortAnswerOptions,
): ShortAnswerCredit {
  const given = parseScalarText(answer);
  if (!isParsed(given)) return hasSeveralValues(answer) ? UNDECIDABLE : INCORRECT;
  const parsedKeys = keys.map((key) => parseScalarText(key)).filter(isParsed);
  if (parsedKeys.length === 0) return INCORRECT;
  return compareCanonical(given, parsedKeys, options.formatKind ?? null, options.equivalences);
}

/**
 * Igual que `matchesAcceptedAnswer`, pero con el crédito: en pares ordenados con
 * `componentCredit` puede ser `partial` (una coordenada bien de dos).
 */
export function creditForAcceptedAnswer(
  raw: unknown,
  accepted: readonly string[],
  options: ShortAnswerOptions = {},
): ShortAnswerCredit {
  if (typeof raw !== 'string') return UNDECIDABLE;
  const cleaned = collapseWhitespace(raw);
  if (cleaned.length === 0) return INCORRECT;
  if (accepted.length === 0) return UNDECIDABLE;

  const mode = options.comparison ?? inferComparisonMode(accepted);
  const withoutUnit = collapseWhitespace(stripUnit(cleaned, options.unit));
  const keys = accepted.map((candidate) =>
    collapseWhitespace(stripUnit(collapseWhitespace(candidate), options.unit)),
  );

  if (mode === 'sequence') return compareSequence(withoutUnit, keys, options);
  if (mode === 'ordered_tuple') return compareTuple(withoutUnit, keys, options);
  if (mode === 'numeric') return compareNumeric(withoutUnit, keys, options);

  const normalize = (value: string) =>
    options.caseSensitive ? value : value.toLocaleLowerCase('es');
  const given = normalize(withoutUnit);
  return keys.some((key) => normalize(key) === given)
    ? { outcome: 'correct', credit: 1 }
    : INCORRECT;
}

/**
 * Compara la respuesta cruda del alumno con las claves aceptadas.
 *
 * Una respuesta vacía es `mismatch` (no respondió), no `undecidable`: eso ya lo
 * decide quien llama, que sabe si hubo marca o no. Un acierto parcial es
 * `mismatch` aquí; el crédito lo informa `creditForAcceptedAnswer`.
 */
export function matchesAcceptedAnswer(
  raw: unknown,
  accepted: readonly string[],
  options: ShortAnswerOptions = {},
): ShortAnswerMatch {
  const { outcome } = creditForAcceptedAnswer(raw, accepted, options);
  if (outcome === 'correct') return 'match';
  return outcome === 'undecidable' ? 'undecidable' : 'mismatch';
}
