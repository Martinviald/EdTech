// Conversión de una respuesta escrita (clave o transcripción) a la estructura
// canónica de su formato y comparación estructurada (diseño §5.5, decisión D6).
//
// Vive en `packages/types` porque la usan `matchesAcceptedAnswer` (corrección de
// CSV y de lectura por visión) y `@soe/answer-reading` (normalizadores): las dos
// tienen que interpretar la respuesta IGUAL.
//
// Reglas:
//   · los números son racionales exactos con enteros en string (sin flotantes);
//   · `written` conserva lo escrito, sin tocar dígitos ni separadores;
//   · lo ambiguo NO se adivina: `1.500` puede ser 1500 o 1,5, y la comparación
//     devuelve `undecidable` si las dos lecturas dan resultados distintos;
//   · pero tampoco se inventa ambigüedad: el formato declarado y las otras claves
//     aceptadas la resuelven cuando pueden (ver `compareCanonical`).

import type {
  CanonicalScalar,
  CanonicalValue,
  NormalizationIssue,
  Rational,
} from '../schemas/answer-reading/normalized-answer.schema';
import {
  DEFAULT_EQUIVALENCES,
  type ComponentCredit,
  type Equivalences,
  type ResponseFormatKind,
} from '../schemas/answer-reading/response-format.schema';

export type CanonicalNumber = Extract<CanonicalValue, { type: 'number' }>;
export type CanonicalFraction = Extract<CanonicalValue, { type: 'fraction' }>;
export type CanonicalTuple = Extract<CanonicalValue, { type: 'tuple' }>;
export type CanonicalSequence = Extract<CanonicalValue, { type: 'sequence' }>;
export type CanonicalWordList = Extract<CanonicalValue, { type: 'word_list' }>;
export type CanonicalText = Extract<CanonicalValue, { type: 'text' }>;

/**
 * Convención del punto. `decimal`: `1.500` es 1,5. `thousands`: `1.500` es 1500.
 * Solo difieren en un número con UN grupo de tres dígitos tras un punto; la coma
 * siempre es decimal y el espacio siempre separa miles.
 */
export const NUMBER_CONVENTIONS = ['decimal', 'thousands'] as const;
export type NumberConvention = (typeof NUMBER_CONVENTIONS)[number];

/**
 * Resultado de interpretar un texto. Por cada convención, las lecturas posibles:
 * ninguna = no se pudo convertir; varias = la aridad no alcanza para decidir
 * (`(2,5,3)` como par). Sin ambigüedad, las dos convenciones traen lo mismo.
 */
export interface CanonicalParse<T extends CanonicalValue = CanonicalValue> {
  readings: Record<NumberConvention, T[]>;
  issues: NormalizationIssue[];
}

export type CanonicalOutcome = 'correct' | 'incorrect' | 'partial' | 'undecidable';

export interface CanonicalComparison {
  outcome: CanonicalOutcome;
  /** 0..1. 1 si es correcta; fracción del puntaje si es parcial; 0 en otro caso. */
  credit: number;
}

// ── Racionales exactos ───────────────────────────────────────────────────────

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function makeRational(numerator: bigint, denominator: bigint): Rational {
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator) || 1n;
  return {
    numerator: ((sign * numerator) / divisor).toString(),
    denominator: ((sign * denominator) / divisor).toString(),
  };
}

function compareRationals(a: Rational, b: Rational): number {
  const left = BigInt(a.numerator) * BigInt(b.denominator);
  const right = BigInt(b.numerator) * BigInt(a.denominator);
  return left === right ? 0 : left < right ? -1 : 1;
}

function subtractRationals(a: Rational, b: Rational): Rational {
  const an = BigInt(a.numerator);
  const ad = BigInt(a.denominator);
  const bn = BigInt(b.numerator);
  const bd = BigInt(b.denominator);
  return makeRational(an * bd - bn * ad, ad * bd);
}

function absRational(a: Rational): Rational {
  return a.numerator.startsWith('-') ? { ...a, numerator: a.numerator.slice(1) } : a;
}

function decimalRational(sign: bigint, whole: string, decimals: string): Rational {
  const digits = BigInt(`${whole || '0'}${decimals}`);
  return makeRational(sign * digits, 10n ** BigInt(decimals.length));
}

/** Tolerancia de la pauta (número JS) como racional exacto. */
function toleranceRational(tolerance: number): Rational {
  const text = tolerance.toString().includes('e') ? tolerance.toFixed(20) : tolerance.toString();
  const [whole = '0', decimals = ''] = text.split('.');
  return decimalRational(1n, whole, decimals);
}

/** Representación decimal exacta de un racional con denominador 2^a·5^b. */
function decimalString(value: Rational): string {
  const numerator = BigInt(value.numerator);
  const denominator = BigInt(value.denominator);
  if (denominator === 1n) return numerator.toString();
  let places = 0;
  let scale = 1n;
  while ((numerator * scale) % denominator !== 0n && places < 40) {
    scale *= 10n;
    places++;
  }
  const scaled = (numerator * scale) / denominator;
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(places + 1, '0');
  const text = `${digits.slice(0, digits.length - places)}.${digits.slice(digits.length - places)}`;
  return negative ? `-${text}` : text;
}

function stripLeadingZeros(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '');
}

// ── Escalares: números y fracciones ──────────────────────────────────────────

const MINUS_SIGNS = /^[-−–]$/;
const PARENTHESIZED_SIGNED = /^\(\s*([+\-−–])\s*(.+?)\s*\)$/;
const LEADING_SIGN = /^([+\-−–])\s*(.+)$/;

const PLAIN_NUMBER = /^(\d+)(?:[.,](\d+))?$/;
const LEADING_SEPARATOR = /^[.,](\d+)$/;
const DOT_GROUPED = /^([1-9]\d{0,2})((?:\.\d{3})+)(?:,(\d+))?$/;
const SPACE_GROUPED = /^([1-9]\d{0,2})((?: \d{3})+)(?:[.,](\d+))?$/;
const FRACTION_BODY = /^(?:(\d+)\s+)?(\d+)\s*[/⁄]\s*(\d+)$/;

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Separa el signo (`-5`, `− 5`, `(-5)`) del cuerpo. Un paréntesis sin signo no es signo. */
function splitSign(text: string): { sign: bigint; body: string } {
  const parenthesized = PARENTHESIZED_SIGNED.exec(text);
  const signed = parenthesized ?? LEADING_SIGN.exec(text);
  if (!signed) return { sign: 1n, body: text };
  const symbol = signed[1] ?? '+';
  return { sign: MINUS_SIGNS.test(symbol) ? -1n : 1n, body: signed[2] ?? '' };
}

function numberFromParts(
  written: string,
  sign: bigint,
  whole: string,
  decimals: string,
): CanonicalNumber {
  return {
    type: 'number',
    value: decimalRational(sign, whole, decimals),
    written,
    decimalPlaces: decimals.length,
  };
}

function parseNumberUnder(text: string, convention: NumberConvention): CanonicalNumber | null {
  const written = collapseWhitespace(text);
  const { sign, body } = splitSign(written);
  const plain = (): CanonicalNumber | null => {
    const match = PLAIN_NUMBER.exec(body);
    if (match) return numberFromParts(written, sign, match[1] ?? '', match[2] ?? '');
    const leading = LEADING_SEPARATOR.exec(body);
    return leading ? numberFromParts(written, sign, '0', leading[1] ?? '') : null;
  };
  const grouped = (): CanonicalNumber | null => {
    const match = DOT_GROUPED.exec(body) ?? SPACE_GROUPED.exec(body);
    if (!match) return null;
    const whole = `${match[1] ?? ''}${(match[2] ?? '').replace(/[. ]/g, '')}`;
    return numberFromParts(written, sign, whole, match[3] ?? '');
  };
  return convention === 'decimal' ? (plain() ?? grouped()) : (grouped() ?? plain());
}

function parseFractionBody(text: string): CanonicalFraction | null {
  const written = collapseWhitespace(text);
  const { sign, body } = splitSign(written);
  const match = FRACTION_BODY.exec(body);
  if (!match) return null;
  const whole = match[1] ?? null;
  const numerator = match[2] ?? '';
  const denominator = match[3] ?? '';
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  if (d === 0n) return null;
  const improper = whole === null ? n : BigInt(whole) * d + n;
  const minus = sign < 0n ? '-' : '';
  return {
    type: 'fraction',
    value: makeRational(sign * improper, d),
    written: {
      whole: whole === null ? null : `${minus}${whole}`,
      numerator: whole === null ? `${minus}${numerator}` : numerator,
      denominator,
    },
    isSimplified: gcd(n, d) === 1n && (whole === null || n < d),
  };
}

function parseScalarUnder(text: string, convention: NumberConvention): CanonicalScalar | null {
  return /[/⁄]/.test(text) ? parseFractionBody(text) : parseNumberUnder(text, convention);
}

function buildParse<T extends CanonicalValue>(
  read: (convention: NumberConvention) => T[],
  issuesWhenEmpty: NormalizationIssue[],
): CanonicalParse<T> {
  const readings = { decimal: read('decimal'), thousands: read('thousands') };
  const issues: NormalizationIssue[] = [];
  if (readings.decimal.length === 0 && readings.thousands.length === 0) {
    issues.push(...issuesWhenEmpty);
  }
  const keys = new Set([...readings.decimal, ...readings.thousands].map(canonicalKey));
  if (keys.size > 1) issues.push('ambiguous_thousands_or_decimal');
  return { readings, issues };
}

/** Entero o decimal: coma o punto decimal, signo, miles con punto o espacio. */
export function parseNumberText(text: string): CanonicalParse<CanonicalNumber> {
  return buildParse(
    (convention) => {
      const value = parseNumberUnder(text, convention);
      return value ? [value] : [];
    },
    ['non_numeric_in_numeric'],
  );
}

/** Fracción `a/b`, número mixto `1 1/2` o negativa. Denominador 0 no se interpreta. */
export function parseFractionText(text: string): CanonicalParse<CanonicalFraction> {
  return buildParse(() => {
    const value = parseFractionBody(text);
    return value ? [value] : [];
  }, ['format_mismatch']);
}

/** Número o fracción, según lo escrito. */
export function parseScalarText(text: string): CanonicalParse<CanonicalScalar> {
  return buildParse(
    (convention) => {
      const value = parseScalarUnder(text, convention);
      return value ? [value] : [];
    },
    ['non_numeric_in_numeric'],
  );
}

// ── Pares ordenados ──────────────────────────────────────────────────────────

const TUPLE_WRAPPER = /^[([{]\s*(.*?)\s*[)\]}]$/;
const EXPLICIT_TUPLE_SEPARATORS = [';', '#', '|'] as const;

/** Agrupa `parts` en `arity` componentes de 1 o 2 partes (2 = coma decimal). */
function commaGroupings(parts: string[], arity: number): string[][] {
  if (arity === 0) return parts.length === 0 ? [[]] : [];
  if (parts.length < arity || parts.length > arity * 2) return [];
  const [first, second, ...rest] = parts;
  if (first === undefined) return [];
  const single = commaGroupings(parts.slice(1), arity - 1).map((tail) => [first, ...tail]);
  if (
    second === undefined ||
    !/^\d+$/.test(first.replace(/^[+\-−–]/, '')) ||
    !/^\d+$/.test(second)
  ) {
    return single;
  }
  const joined = commaGroupings(rest, arity - 1).map((tail) => [`${first},${second}`, ...tail]);
  return [...single, ...joined];
}

function tupleCandidates(text: string, arity: number | undefined): string[][] {
  const written = collapseWhitespace(text);
  const wrapped = TUPLE_WRAPPER.exec(written);
  const inner = (wrapped ? (wrapped[1] ?? '') : written).trim();
  if (inner.length === 0) return [];
  const explicit = EXPLICIT_TUPLE_SEPARATORS.find((separator) => inner.includes(separator));
  if (explicit) return [inner.split(explicit).map((part) => part.trim())];
  if (inner.includes(',')) {
    const parts = inner.split(',').map((part) => part.trim());
    if (arity === undefined || parts.length === arity) {
      // Sin envoltura, `7,3` es un decimal salvo que el formato pida un par.
      return wrapped || arity !== undefined ? [parts] : [];
    }
    return wrapped ? commaGroupings(parts, arity) : [];
  }
  if (inner.includes(' ')) return [inner.split(' ')];
  return [];
}

/**
 * Par o terna ordenada: `(7;3)`, `(7,3)`, `7;3`, `7 3`, `[7#3]` (GradeCam).
 * El separador más explícito manda: en `(2,5;3)` la coma es decimal. Si solo hay
 * comas y sobran, la aridad esperada decide; si aún así hay varias lecturas, se
 * informan todas (ambigua).
 */
export function parseOrderedTupleText(
  text: string,
  arity?: number,
): CanonicalParse<CanonicalTuple> {
  const candidates = tupleCandidates(text, arity);
  const parse = buildParse<CanonicalTuple>(
    (convention) => {
      const tuples: CanonicalTuple[] = [];
      for (const parts of candidates) {
        if (parts.length < 2 || parts.some((part) => part.length === 0)) continue;
        const components = parts.map((part) => parseScalarUnder(part, convention));
        if (components.every((component): component is CanonicalScalar => component !== null)) {
          tuples.push({ type: 'tuple', components });
        }
      }
      return tuples;
    },
    ['format_mismatch'],
  );
  const lengths = [...parse.readings.decimal, ...parse.readings.thousands].map(
    (tuple) => tuple.components.length,
  );
  if (arity !== undefined && lengths.some((length) => length !== arity)) {
    parse.issues.push('format_mismatch');
  }
  return parse;
}

// ── Secuencias ───────────────────────────────────────────────────────────────

// Un guion es signo solo cuando abre el elemento (`(-3,2)`); entre dígitos separa.
const SEQUENCE_TOKEN = /(?:(?<![\p{L}\p{N}])[-−])?[\p{L}\p{N}]+/gu;
// Solo los números, como en la corrección previa a F2: `R: 3-1-4-2` y
// `P3-P1-P4-P2` son el orden 3, 1, 4, 2.
const NUMERIC_SEQUENCE_TOKEN = /(?<!\d)[-−]?\d+/g;

function normalizeElement(token: string): string {
  const numeric = /^([-−]?)(\d+)$/.exec(token);
  if (numeric) {
    const digits = stripLeadingZeros(numeric[2] ?? '');
    return numeric[1] && digits !== '0' ? `-${digits}` : digits;
  }
  return token.toLocaleLowerCase('es');
}

export interface SequenceParseOptions {
  /** Largo esperado (de la clave o del formato). */
  expectedLength?: number;
  /**
   * Acepta `3142` como cuatro elementos cuando el largo esperado coincide.
   * Solo vale si cada elemento es de un carácter (lo decide quien llama).
   */
  allowPasted?: boolean;
  /**
   * Toma solo los números y descarta letras y rótulos (`R:`, `P3`). Lo usa quien
   * compara contra una clave numérica; una clave de palabras compara palabras.
   */
  numericOnly?: boolean;
}

/** `true` si el texto trae algún dígito: su secuencia se compara por números. */
export function isNumericSequenceText(text: string): boolean {
  return /\d/.test(text);
}

/** Secuencia con cualquier separador no alfanumérico: `3-1-4-2`, `3,1,4,2`, `2 – 4 – 3 – 1`. */
export function parseSequenceText(
  text: string,
  options: SequenceParseOptions = {},
): CanonicalParse<CanonicalSequence> {
  const { expectedLength, allowPasted, numericOnly } = options;
  const tokens =
    collapseWhitespace(text).match(numericOnly ? NUMERIC_SEQUENCE_TOKEN : SEQUENCE_TOKEN) ?? [];
  const only = tokens.length === 1 ? (tokens[0] ?? '') : null;
  const pasted =
    only !== null &&
    allowPasted === true &&
    expectedLength !== undefined &&
    expectedLength >= 2 &&
    /^[\p{L}\p{N}]+$/u.test(only) &&
    [...only].length === expectedLength;
  const elements = (pasted && only !== null ? [...only] : tokens).map(normalizeElement);
  const parse = buildParse<CanonicalSequence>(
    () => (elements.length > 0 ? [{ type: 'sequence', elements }] : []),
    ['format_mismatch'],
  );
  if (elements.length > 0 && expectedLength !== undefined && elements.length !== expectedLength) {
    parse.issues.push('format_mismatch');
  }
  return parse;
}

// ── Texto corto y listas de palabras ─────────────────────────────────────────

const SINGLE_QUOTES = /[‘’‚‛′`´]/g;
const DOUBLE_QUOTES = /[“”„‟«»"″]/g;
const LEADING_PUNCTUATION = /^[¿¡\s]+/;
const TRAILING_PUNCTUATION = /[\s.,;:!?…]+$/;

/**
 * Texto corto normalizado para comparar (`short_text`): espacios colapsados,
 * comillas tipográficas unificadas (las dobles se quitan), sin `¿¡` iniciales ni
 * puntuación final y, salvo `caseSensitive`, sin mayúsculas. Las tildes se
 * conservan: `esta` y `está` son respuestas distintas (y van a revisión).
 */
export function normalizeShortText(value: string, caseSensitive = false): string {
  const text = value
    .normalize('NFC')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '')
    .replace(/\s+/g, ' ')
    .replace(LEADING_PUNCTUATION, '')
    .replace(TRAILING_PUNCTUATION, '')
    .trim();
  return caseSensitive ? text : text.toLocaleLowerCase('es');
}

/** Texto corto: un solo valor de texto normalizado; vacío = no interpretable. */
export function parseShortText(text: string): CanonicalParse<CanonicalText> {
  const normalized = normalizeShortText(text);
  return buildParse<CanonicalText>(
    () => (normalized.length > 0 ? [{ type: 'text', text: normalized }] : []),
    ['empty_part'],
  );
}

const WORD_SEPARATORS = /[,;\n]|\s[-–—]\s|\s(?:y|e)\s/giu;
const LIST_BULLET = /^\s*[-–—•*·]\s+/gmu;
/** Separa alternativas de una palabra en la CLAVE: `abdomen/vientre`. */
export const WORD_ALTERNATIVE_SEPARATOR = '/';

/** Palabra normalizada: sin mayúsculas, sin tildes y sin puntuación en los bordes. */
export function normalizeWord(value: string): string {
  return normalizeText(value)
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '')
    .replace(/^[\s¿¡.,;:!?…()]+|[\s.,;:!?…()]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\/\s*/g, WORD_ALTERNATIVE_SEPARATOR);
}

export interface WordListParseOptions {
  /** Cantidad de palabras esperada (del formato). */
  expectedCount?: number;
}

/**
 * Lista de palabras: `Cabeza, tórax, abdomen`, `cabeza; tórax y abdomen`, una por
 * renglón o con guiones de lista. Cada palabra se normaliza (`normalizeWord`).
 */
export function parseWordListText(
  text: string,
  options: WordListParseOptions = {},
): CanonicalParse<CanonicalWordList> {
  const words = ` ${text.replace(LIST_BULLET, '\n')} `
    .split(WORD_SEPARATORS)
    .map(normalizeWord)
    .filter((word) => word.length > 0);
  const parse = buildParse<CanonicalWordList>(
    () => (words.length > 0 ? [{ type: 'word_list', words }] : []),
    ['empty_part'],
  );
  if (
    words.length > 0 &&
    options.expectedCount !== undefined &&
    words.length > options.expectedCount
  ) {
    parse.issues.push('extra_tokens');
  }
  return parse;
}

/** Distancia de edición ≤ 1 (una letra cambiada, sobrante o faltante). */
function withinOneEdit(a: string, b: string): boolean {
  const left = [...a];
  const right = [...b];
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (left.length > right.length) i++;
    else if (right.length > left.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (left.length - i) + (right.length - j) <= 1;
}

/** Largo mínimo de la palabra de la clave para considerar una falta ortográfica pequeña. */
export const NEAR_MISS_MIN_LETTERS = 5;

type WordMatch = 'same' | 'near' | 'different';

const isSame = (match: WordMatch) => match === 'same';
const isClose = (match: WordMatch) => match !== 'different';

function matchWord(given: string, key: string): WordMatch {
  const alternatives = key.split(WORD_ALTERNATIVE_SEPARATOR).filter(Boolean);
  if (alternatives.includes(given)) return 'same';
  const near = alternatives.some(
    (alternative) =>
      [...alternative].length >= NEAR_MISS_MIN_LETTERS && withinOneEdit(given, alternative),
  );
  return near ? 'near' : 'different';
}

/**
 * Asignación palabra respondida → posición de la clave que maximiza el crédito
 * (caminos de aumento procesando las posiciones de mayor peso primero: óptimo en
 * un matroide transversal). `accepts` decide si una palabra puede ocupar una posición.
 */
function bestAssignmentCredit(
  given: readonly string[],
  key: readonly string[],
  weights: readonly number[],
  unordered: boolean,
  accepts: (match: WordMatch) => boolean,
): { credit: number; matched: number } {
  const canTake = (g: number, k: number) => {
    const word = given[g];
    const keyWord = key[k];
    if (word === undefined || keyWord === undefined) return false;
    if (!unordered && g !== k) return false;
    return accepts(matchWord(word, keyWord));
  };
  const ownerOfGiven = new Map<number, number>();
  const tryAssign = (k: number, visited: Set<number>): boolean => {
    for (let g = 0; g < given.length; g++) {
      if (visited.has(g) || !canTake(g, k)) continue;
      visited.add(g);
      const owner = ownerOfGiven.get(g);
      if (owner === undefined || tryAssign(owner, visited)) {
        ownerOfGiven.set(g, k);
        return true;
      }
    }
    return false;
  };
  const order = key.map((_, index) => index).sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0));
  for (const k of order) tryAssign(k, new Set());
  let credit = 0;
  for (const k of ownerOfGiven.values()) credit += weights[k] ?? 0;
  return { credit, matched: ownerOfGiven.size };
}

/**
 * Compara listas de palabras (§5.5). Sin mayúsculas ni tildes; el orden importa
 * salvo `unordered`. Sinónimos y faltas valen solo si están en la clave (como
 * alternativas `abdomen/vientre` o como otra clave aceptada): no hay corrección
 * difusa. Lo que no calza va a revisión (`undecidable`) cuando la única diferencia
 * es una falta pequeña (distancia de edición 1 en una palabra de 5 o más letras) o
 * cuando la respuesta trae todas las palabras y otras de más; si no, es incorrecta.
 * Crédito por palabra solo con `componentCredit`.
 */
export function compareWordLists(
  given: CanonicalWordList,
  key: CanonicalWordList,
  unordered: boolean,
  componentCredit?: ComponentCredit,
): CanonicalComparison {
  const answered = given.words.map(normalizeWord);
  const expected = key.words.map(normalizeWord);
  if (answered.some((word) => word.includes(WORD_ALTERNATIVE_SEPARATOR))) return UNDECIDABLE;
  const unit = expected.map(() => 1);
  const strict = bestAssignmentCredit(answered, expected, unit, unordered, isSame);
  const allKeyWords = strict.matched === expected.length;
  if (allKeyWords && answered.length === expected.length) return CORRECT;
  if (allKeyWords) return UNDECIDABLE;
  const loose = bestAssignmentCredit(answered, expected, unit, unordered, isClose);
  const weights = componentCredit?.creditPerComponent ?? null;
  if (weights === null) {
    const fixableBySpelling =
      loose.matched === expected.length && answered.length === expected.length;
    return fixableBySpelling ? UNDECIDABLE : INCORRECT;
  }
  const strictCredit = bestAssignmentCredit(answered, expected, weights, unordered, isSame).credit;
  const looseCredit = bestAssignmentCredit(answered, expected, weights, unordered, isClose).credit;
  if (looseCredit > strictCredit) return UNDECIDABLE;
  return strictCredit > 0 ? { outcome: 'partial', credit: Math.min(strictCredit, 1) } : INCORRECT;
}

/**
 * Texto corto: coincidencia exacta normalizada con alguna clave = correcta; si
 * no, indecidible. En texto libre corto la corrección automática nunca marca
 * incorrecta por una diferencia de redacción.
 */
export function compareShortText(
  given: string,
  keys: readonly string[],
  caseSensitive = false,
): CanonicalComparison {
  const answer = normalizeShortText(given, caseSensitive);
  if (answer.length === 0) return INCORRECT;
  return keys.some((key) => normalizeShortText(key, caseSensitive) === answer)
    ? CORRECT
    : UNDECIDABLE;
}

// ── Utilidades sobre el resultado de interpretar ─────────────────────────────

export function isParsed(parse: CanonicalParse): boolean {
  return parse.readings.decimal.length > 0 && parse.readings.thousands.length > 0;
}

function distinctReadings<T extends CanonicalValue>(parse: CanonicalParse<T>): T[] {
  const byKey = new Map<string, T>();
  for (const value of [...parse.readings.decimal, ...parse.readings.thousands]) {
    if (!byKey.has(canonicalKey(value))) byKey.set(canonicalKey(value), value);
  }
  return [...byKey.values()];
}

/** El valor si la lectura es única; `null` si no se interpretó o es ambigua. */
export function uniqueReading<T extends CanonicalValue>(parse: CanonicalParse<T>): T | null {
  const distinct = distinctReadings(parse);
  return distinct.length === 1 ? (distinct[0] ?? null) : null;
}

/**
 * Lectura principal: la única, o la de la convención `decimal` si es ambigua
 * (quien la use debe mirar `issues`). `null` si no se interpretó.
 */
export function primaryReading<T extends CanonicalValue>(parse: CanonicalParse<T>): T | null {
  return parse.readings.decimal[0] ?? parse.readings.thousands[0] ?? null;
}

/**
 * Clave para agrupar e igualar lecturas. Si la interpretación es ambigua, la clave
 * junta todas las lecturas (`amb:…`): dos lectores que leen `1.500` coinciden.
 */
export function parseCanonicalKey(parse: CanonicalParse): string | null {
  const keys = [...new Set(distinctReadings(parse).map(canonicalKey))].sort();
  if (keys.length === 0) return null;
  return keys.length === 1 ? (keys[0] ?? null) : `amb:${keys.join('||')}`;
}

// ── Clave canónica ───────────────────────────────────────────────────────────

function rationalKey(value: Rational): string {
  return value.denominator === '1' ? value.numerator : `${value.numerator}/${value.denominator}`;
}

function fractionKey(value: CanonicalFraction): string {
  const negative = (value.written.whole ?? value.written.numerator).startsWith('-');
  const unsigned = (digits: string) => stripLeadingZeros(digits.replace(/^-/, ''));
  const whole = value.written.whole === null ? '' : `${unsigned(value.written.whole)} `;
  const sign = negative && value.value.numerator !== '0' ? '-' : '';
  return `${sign}${whole}${unsigned(value.written.numerator)}/${unsigned(value.written.denominator)}`;
}

function scalarComponentKey(value: CanonicalScalar): string {
  return value.type === 'number' ? decimalString(value.value) : fractionKey(value);
}

/**
 * Clave estable de lo escrito, normalizado (no la equivalencia matemática laxa):
 * `2,5` y `2.50` → `n:5/2`; `6/8` → `f:6/8` y `3/4` → `f:3/4` son distintas.
 */
export function canonicalKey(value: CanonicalValue): string {
  switch (value.type) {
    case 'number':
      return `n:${rationalKey(value.value)}`;
    case 'fraction':
      return `f:${fractionKey(value)}`;
    case 'tuple':
      return `t:${value.components.map(scalarComponentKey).join('|')}`;
    case 'sequence':
      return `s:${value.elements.join('|')}`;
    case 'word_list':
      return `w:${value.words.join('|')}`;
    case 'text':
      return `x:${value.text}`;
    case 'multi_box':
      return `m:${Object.keys(value.parts)
        .sort()
        .map((partId) => {
          const part = value.parts[partId];
          if (!part) return `${partId}=`;
          return `${partId}=${part.type === 'text' ? `x:${part.text}` : canonicalKey(part)}`;
        })
        .join(';')}`;
  }
}

// ── Comparación ──────────────────────────────────────────────────────────────

/**
 * Equivalencias efectivas: las por defecto (§5.5) con la pauta encima. La
 * fracción↔decimal solo está apagada por defecto cuando el ítem declara el
 * formato `fraction`; sin formato declarado se conserva la corrección histórica,
 * que acepta `2,1` contra `21/10`.
 */
export function resolveEquivalences(
  formatKind: ResponseFormatKind | null,
  equivalences: Equivalences = {},
): Required<Equivalences> {
  const declared = Object.fromEntries(
    Object.entries(equivalences).filter(([, value]) => value !== undefined),
  ) as Equivalences;
  return {
    ...DEFAULT_EQUIVALENCES,
    acceptDecimalEquivalent:
      formatKind === 'fraction' ? DEFAULT_EQUIVALENCES.acceptDecimalEquivalent : true,
    ...declared,
  };
}

function improperPair(value: CanonicalFraction): [bigint, bigint] {
  const numerator = BigInt(value.written.numerator.replace(/^-/, ''));
  const denominator = BigInt(value.written.denominator);
  const whole = value.written.whole === null ? 0n : BigInt(value.written.whole.replace(/^-/, ''));
  return [whole * denominator + numerator, denominator];
}

type ScalarMatch = 'same' | 'different' | 'contradictory';

/**
 * La clave no es del tipo que pide el formato declarado: un decimal (`0,5`) en un
 * ítem de formato fracción, o una fracción en uno entero o decimal.
 */
function keyContradictsFormat(
  key: CanonicalScalar,
  formatKind: ResponseFormatKind | null,
): boolean {
  if (formatKind === 'fraction') return key.type === 'number';
  if (formatKind === 'integer' || formatKind === 'decimal') return key.type === 'fraction';
  return false;
}

function sameScalar(
  given: CanonicalScalar,
  key: CanonicalScalar,
  equivalences: Required<Equivalences>,
  formatKind: ResponseFormatKind | null,
): ScalarMatch {
  const sameValue =
    equivalences.tolerance > 0
      ? compareRationals(
          absRational(subtractRationals(given.value, key.value)),
          toleranceRational(equivalences.tolerance),
        ) <= 0
      : compareRationals(given.value, key.value) === 0;
  if (!sameValue) return 'different';
  if (given.type !== key.type && !equivalences.acceptDecimalEquivalent) {
    // La clave contradice el formato y el alumno respondió en el formato pedido:
    // no se puede decidir si la pauta quería aceptar el equivalente.
    return keyContradictsFormat(key, formatKind) ? 'contradictory' : 'different';
  }
  if (given.type === 'fraction') {
    if (equivalences.requireSimplified && !given.isSimplified) return 'different';
    if (key.type === 'fraction' && !equivalences.acceptEquivalentFractions) {
      const [gn, gd] = improperPair(given);
      const [kn, kd] = improperPair(key);
      if (gn !== kn || gd !== kd) return 'different';
    }
  }
  if (given.type === 'number' && key.type === 'number' && equivalences.requireExactDecimals) {
    return given.decimalPlaces === key.decimalPlaces ? 'same' : 'different';
  }
  return 'same';
}

/** Texto sin tildes, sin mayúsculas y sin espacios en los bordes. */
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').trim();
}

function sameElements(given: string[], key: string[], unordered: boolean): boolean {
  if (given.length !== key.length) return false;
  if (!unordered) return given.every((element, index) => element === key[index]);
  const sortedGiven = [...given].sort();
  const sortedKey = [...key].sort();
  return sortedGiven.every((element, index) => element === sortedKey[index]);
}

const CORRECT: CanonicalComparison = { outcome: 'correct', credit: 1 };
const INCORRECT: CanonicalComparison = { outcome: 'incorrect', credit: 0 };
const UNDECIDABLE: CanonicalComparison = { outcome: 'undecidable', credit: 0 };

interface CompareContext {
  readonly equivalences: Required<Equivalences>;
  readonly formatKind: ResponseFormatKind | null;
  readonly componentCredit: ComponentCredit | undefined;
}

function scalarComparison(match: ScalarMatch): CanonicalComparison {
  if (match === 'same') return CORRECT;
  return match === 'contradictory' ? UNDECIDABLE : INCORRECT;
}

function compareTuples(
  given: CanonicalTuple,
  key: CanonicalTuple,
  context: CompareContext,
): CanonicalComparison {
  if (given.components.length !== key.components.length) return INCORRECT;
  const matches = key.components.map((component, index) => {
    const answered = given.components[index];
    return answered === undefined
      ? 'different'
      : sameScalar(answered, component, context.equivalences, context.formatKind);
  });
  if (matches.every((match) => match === 'same')) return CORRECT;
  const { componentCredit } = context;
  if (!componentCredit) {
    return matches.includes('different') ? INCORRECT : UNDECIDABLE;
  }
  const credit = matches.reduce(
    (sum, match, index) =>
      sum + (match === 'same' ? (componentCredit.creditPerComponent[index] ?? 0) : 0),
    0,
  );
  return credit > 0 ? { outcome: 'partial', credit: Math.min(credit, 1) } : INCORRECT;
}

function compareOne(
  given: CanonicalValue,
  key: CanonicalValue,
  context: CompareContext,
): CanonicalComparison {
  const { equivalences } = context;
  if (
    (given.type === 'number' || given.type === 'fraction') &&
    (key.type === 'number' || key.type === 'fraction')
  ) {
    return scalarComparison(sameScalar(given, key, equivalences, context.formatKind));
  }
  if (given.type === 'tuple' && key.type === 'tuple') {
    return compareTuples(given, key, context);
  }
  if (given.type === 'sequence' && key.type === 'sequence') {
    return sameElements(given.elements, key.elements, equivalences.unordered) ? CORRECT : INCORRECT;
  }
  if (given.type === 'word_list' && key.type === 'word_list') {
    return compareWordLists(given, key, equivalences.unordered, context.componentCredit);
  }
  if (given.type === 'text' && key.type === 'text') {
    return compareShortText(given.text, [key.text]);
  }
  return INCORRECT;
}

/** Mejor resultado entre claves: correcta > indecidible > parcial > incorrecta. */
function best(results: CanonicalComparison[]): CanonicalComparison {
  if (results.some((result) => result.outcome === 'correct')) return CORRECT;
  if (results.some((result) => result.outcome === 'undecidable')) return UNDECIDABLE;
  const partials = results.filter((result) => result.outcome === 'partial');
  if (partials.length === 0) return INCORRECT;
  return partials.reduce((top, result) => (result.credit > top.credit ? result : top));
}

function asParse(value: CanonicalValue | CanonicalParse): CanonicalParse {
  return 'readings' in value
    ? value
    : { readings: { decimal: [value], thousands: [value] }, issues: [] };
}

function isAmbiguousNumber(parse: CanonicalParse): boolean {
  return (
    parse.issues.includes('ambiguous_thousands_or_decimal') &&
    [...parse.readings.decimal, ...parse.readings.thousands].every(
      (value) => value.type === 'number',
    )
  );
}

function withConvention<T extends CanonicalValue>(
  parse: CanonicalParse<T>,
  convention: NumberConvention,
): CanonicalParse<T> {
  const readings = parse.readings[convention];
  return {
    readings: { decimal: readings, thousands: readings },
    issues: parse.issues.filter((issue) => issue !== 'ambiguous_thousands_or_decimal'),
  };
}

/**
 * Resuelve la ambigüedad miles/decimal (`1.500`) con el formato declarado:
 *  · `integer`: el punto separa miles, en la respuesta y en la clave (`1.500` = 1500);
 *  · `decimal`: la CLAVE con tres decimales se lee como decimal (`2.125` = 2,125);
 *    la respuesta del alumno sigue siendo ambigua.
 * Sin formato que la resuelva, devuelve la interpretación sin cambios.
 */
export function resolveNumberConvention<T extends CanonicalValue>(
  parse: CanonicalParse<T>,
  formatKind: ResponseFormatKind | null,
  role: 'answer' | 'key',
): CanonicalParse<T> {
  if (!isAmbiguousNumber(parse)) return parse;
  if (formatKind === 'integer') return withConvention(parse, 'thousands');
  if (formatKind === 'decimal' && role === 'key') return withConvention(parse, 'decimal');
  return parse;
}

/** Una clave ambigua se resuelve si una de sus lecturas es otra clave aceptada inequívoca. */
function disambiguateKeys(keys: readonly CanonicalParse[]): CanonicalParse[] {
  const unambiguous = new Set(
    keys
      .filter((parse) => !isAmbiguousNumber(parse))
      .flatMap((parse) => distinctReadings(parse).map(canonicalKey)),
  );
  return keys.map((parse) => {
    if (!isAmbiguousNumber(parse)) return parse;
    const matching = NUMBER_CONVENTIONS.filter((convention) =>
      parse.readings[convention].some((value) => unambiguous.has(canonicalKey(value))),
    );
    const [only] = matching;
    return matching.length === 1 && only ? withConvention(parse, only) : parse;
  });
}

/** Signo, dígitos y posición del separador, con la coma y el punto como el mismo signo. */
function writtenShape(parse: CanonicalParse): string | null {
  const value = primaryReading(parse);
  if (value === null || value.type !== 'number') return null;
  return value.written.replace(/[−–]/g, '-').replace(/,/g, '.').replace(/\s/g, '');
}

/**
 * La respuesta repite la escritura de la clave y solo cambia la coma por el punto
 * (`2,125` contra `2.125`). Si alguna de las dos es ambigua, con cualquier
 * convención que se aplique igual a ambas dicen lo mismo: no hay ambigüedad real.
 */
function sameWritingAsAmbiguousKey(
  given: CanonicalParse,
  keys: readonly CanonicalParse[],
): boolean {
  const shape = writtenShape(given);
  if (shape === null) return false;
  return keys.some(
    (key) => (isAmbiguousNumber(given) || isAmbiguousNumber(key)) && writtenShape(key) === shape,
  );
}

/**
 * Compara la respuesta con las claves aceptadas. Cada convención del punto se
 * evalúa por separado (clave y respuesta con la MISMA convención); si las
 * lecturas posibles no llevan todas al mismo resultado → `undecidable`.
 *
 * Ambigüedad miles/decimal: solo existe con un punto seguido de exactamente tres
 * dígitos y sin otro separador (`1.500`, `2.125`; no `1.234.567` ni `0.500`). Antes
 * de declararla indecidible se resuelve con, en orden:
 *  1. el formato declarado (`resolveNumberConvention`);
 *  2. las otras claves aceptadas (`['2.125', '2,125']` fija la lectura decimal);
 *  3. la misma escritura: `2,125` contra la clave `2.125` coincide.
 * Lo que sigue ambiguo y cambia el resultado (`1` contra la clave `1.000` sin
 * formato) va a revisión.
 *
 * Fracción ↔ decimal: si el valor coincide pero el tipo no y la pauta no acepta el
 * equivalente, es incorrecta; salvo que sea la CLAVE la que contradice el formato
 * (`0,5` en un ítem de formato fracción): eso es indecidible.
 *
 * Crédito por componente en pares ordenados solo si se pasa `componentCredit`;
 * sin él, todo o nada. Sin claves interpretables → `undecidable`.
 */
export function compareCanonical(
  given: CanonicalValue | CanonicalParse,
  accepted: ReadonlyArray<CanonicalValue | CanonicalParse>,
  formatKind: ResponseFormatKind | null,
  equivalences?: Equivalences,
  componentCredit?: ComponentCredit,
): CanonicalComparison {
  const context: CompareContext = {
    equivalences: resolveEquivalences(formatKind, equivalences),
    formatKind,
    componentCredit,
  };
  const givenParse = resolveNumberConvention(asParse(given), formatKind, 'answer');
  const keyParses = disambiguateKeys(
    accepted.map((key) => resolveNumberConvention(asParse(key), formatKind, 'key')),
  );
  if (sameWritingAsAmbiguousKey(givenParse, keyParses)) return CORRECT;
  const results: CanonicalComparison[] = [];
  for (const convention of NUMBER_CONVENTIONS) {
    const keys = keyParses.flatMap((parse) => parse.readings[convention]);
    if (keys.length === 0) return UNDECIDABLE;
    const candidates = givenParse.readings[convention];
    if (candidates.length === 0) return INCORRECT;
    for (const candidate of candidates) {
      results.push(best(keys.map((key) => compareOne(candidate, key, context))));
    }
  }
  const [first, ...rest] = results;
  if (!first) return UNDECIDABLE;
  const agree = rest.every(
    (result) => result.outcome === first.outcome && result.credit === first.credit,
  );
  return agree ? first : UNDECIDABLE;
}
