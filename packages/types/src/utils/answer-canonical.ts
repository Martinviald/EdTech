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
//     devuelve `undecidable` si las dos lecturas dan resultados distintos.

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
}

/** Secuencia con cualquier separador no alfanumérico: `3-1-4-2`, `3,1,4,2`, `2 – 4 – 3 – 1`. */
export function parseSequenceText(
  text: string,
  options: SequenceParseOptions = {},
): CanonicalParse<CanonicalSequence> {
  const tokens = collapseWhitespace(text).match(SEQUENCE_TOKEN) ?? [];
  const { expectedLength, allowPasted } = options;
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

function sameScalar(
  given: CanonicalScalar,
  key: CanonicalScalar,
  equivalences: Required<Equivalences>,
): boolean {
  const sameValue =
    equivalences.tolerance > 0
      ? compareRationals(
          absRational(subtractRationals(given.value, key.value)),
          toleranceRational(equivalences.tolerance),
        ) <= 0
      : compareRationals(given.value, key.value) === 0;
  if (!sameValue) return false;
  if (given.type !== key.type && !equivalences.acceptDecimalEquivalent) return false;
  if (given.type === 'fraction') {
    if (equivalences.requireSimplified && !given.isSimplified) return false;
    if (key.type === 'fraction' && !equivalences.acceptEquivalentFractions) {
      const [gn, gd] = improperPair(given);
      const [kn, kd] = improperPair(key);
      if (gn !== kn || gd !== kd) return false;
    }
  }
  if (given.type === 'number' && key.type === 'number' && equivalences.requireExactDecimals) {
    return given.decimalPlaces === key.decimalPlaces;
  }
  return true;
}

function normalizeWord(value: string): string {
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

function compareTuples(
  given: CanonicalTuple,
  key: CanonicalTuple,
  equivalences: Required<Equivalences>,
  componentCredit: ComponentCredit | undefined,
): CanonicalComparison {
  if (given.components.length !== key.components.length) return INCORRECT;
  const hits = key.components.map((component, index) => {
    const answered = given.components[index];
    return answered !== undefined && sameScalar(answered, component, equivalences);
  });
  if (hits.every(Boolean)) return CORRECT;
  if (!componentCredit) return INCORRECT;
  const credit = hits.reduce(
    (sum, hit, index) => sum + (hit ? (componentCredit.creditPerComponent[index] ?? 0) : 0),
    0,
  );
  return credit > 0 ? { outcome: 'partial', credit: Math.min(credit, 1) } : INCORRECT;
}

function compareOne(
  given: CanonicalValue,
  key: CanonicalValue,
  equivalences: Required<Equivalences>,
  componentCredit: ComponentCredit | undefined,
): CanonicalComparison {
  if (
    (given.type === 'number' || given.type === 'fraction') &&
    (key.type === 'number' || key.type === 'fraction')
  ) {
    return sameScalar(given, key, equivalences) ? CORRECT : INCORRECT;
  }
  if (given.type === 'tuple' && key.type === 'tuple') {
    return compareTuples(given, key, equivalences, componentCredit);
  }
  if (given.type === 'sequence' && key.type === 'sequence') {
    return sameElements(given.elements, key.elements, equivalences.unordered) ? CORRECT : INCORRECT;
  }
  if (given.type === 'word_list' && key.type === 'word_list') {
    return sameElements(
      given.words.map(normalizeWord),
      key.words.map(normalizeWord),
      equivalences.unordered,
    )
      ? CORRECT
      : INCORRECT;
  }
  if (given.type === 'text' && key.type === 'text') {
    return normalizeWord(given.text) === normalizeWord(key.text) ? CORRECT : INCORRECT;
  }
  return INCORRECT;
}

function best(results: CanonicalComparison[]): CanonicalComparison {
  if (results.some((result) => result.outcome === 'correct')) return CORRECT;
  const partials = results.filter((result) => result.outcome === 'partial');
  if (partials.length === 0) return INCORRECT;
  return partials.reduce((top, result) => (result.credit > top.credit ? result : top));
}

function asParse(value: CanonicalValue | CanonicalParse): CanonicalParse {
  return 'readings' in value
    ? value
    : { readings: { decimal: [value], thousands: [value] }, issues: [] };
}

/**
 * Compara la respuesta con las claves aceptadas. Cada convención del punto se
 * evalúa por separado (clave y respuesta con la MISMA convención); si las
 * lecturas posibles no llevan todas al mismo resultado → `undecidable`.
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
  const resolved = resolveEquivalences(formatKind, equivalences);
  const givenParse = asParse(given);
  const keyParses = accepted.map(asParse);
  const results: CanonicalComparison[] = [];
  for (const convention of NUMBER_CONVENTIONS) {
    const keys = keyParses.flatMap((parse) => parse.readings[convention]);
    if (keys.length === 0) return UNDECIDABLE;
    const candidates = givenParse.readings[convention];
    if (candidates.length === 0) return INCORRECT;
    for (const candidate of candidates) {
      results.push(best(keys.map((key) => compareOne(candidate, key, resolved, componentCredit))));
    }
  }
  const [first, ...rest] = results;
  if (!first) return UNDECIDABLE;
  const agree = rest.every(
    (result) => result.outcome === first.outcome && result.credit === first.credit,
  );
  return agree ? first : UNDECIDABLE;
}
