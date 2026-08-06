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
//     — ahí no se puede saber qué respondió, y adivinar sería inventar un dato.

/** Resultado de comparar una respuesta contra las claves aceptadas. */
export type ShortAnswerMatch = 'match' | 'mismatch' | 'undecidable';

export type ShortAnswerOptions = {
  comparison?: 'numeric' | 'text';
  unit?: string;
  caseSensitive?: boolean;
};

const FRACTION = /^([+-]?\d+)\s*\/\s*(\d+)$/;
const DECIMAL = /^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/;

/** Un racional exacto, para no comparar `21/10` con `2.1` en punto flotante. */
type Rational = { numerator: number; denominator: number };

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** `21 / 10` es UN valor: la barra no separa dos números, los relaciona. */
function tightenFractionSlash(value: string): string {
  return value.replace(/\s*\/\s*/g, '/');
}

function stripUnit(value: string, unit: string | undefined): string {
  if (!unit) return value;
  const normalized = value.toLowerCase();
  const suffix = unit.trim().toLowerCase();
  if (!suffix || !normalized.endsWith(suffix)) return value;
  return value.slice(0, value.length - suffix.length).trim();
}

function parseRational(value: string): Rational | null {
  const fraction = FRACTION.exec(value);
  if (fraction) {
    const denominator = Number(fraction[2]);
    if (denominator === 0) return null;
    return { numerator: Number(fraction[1]), denominator };
  }
  if (!DECIMAL.test(value)) return null;
  const normalized = value.replace(',', '.');
  const [whole, decimals = ''] = normalized.split('.');
  const denominator = 10 ** decimals.length;
  const digits = `${whole === '' || whole === '+' || whole === '-' ? `${whole}0` : whole}${decimals}`;
  const numerator = Number(digits);
  return Number.isFinite(numerator) ? { numerator, denominator } : null;
}

function sameRational(a: Rational, b: Rational): boolean {
  return a.numerator * b.denominator === b.numerator * a.denominator;
}

/**
 * Un valor es indecidible cuando contiene más de un número candidato: `0=16.5`,
 * `1 4`, `2,5-2`. Un separador de miles no cuenta (`1.234` es un solo número), por
 * eso se mira si al partir por separadores quedan varios tokens numéricos.
 */
function isAmbiguous(value: string): boolean {
  const tokens = value.split(/[\s=;|]+/).filter(Boolean);
  if (tokens.length > 1 && tokens.filter((t) => /\d/.test(t)).length > 1) return true;
  return /\d\s*[-+*][\s]*\d/.test(value) && !FRACTION.test(value);
}

function looksNumeric(value: string): boolean {
  return parseRational(value) !== null;
}

/** Deriva el modo de comparación cuando el ítem no lo declara. */
export function inferComparisonMode(accepted: readonly string[]): 'numeric' | 'text' {
  const cleaned = accepted.map((a) => collapseWhitespace(a)).filter(Boolean);
  return cleaned.length > 0 && cleaned.every(looksNumeric) ? 'numeric' : 'text';
}

/**
 * Compara la respuesta cruda del alumno con las claves aceptadas.
 *
 * Una respuesta vacía es `mismatch` (no respondió), no `undecidable`: eso ya lo
 * decide quien llama, que sabe si hubo marca o no.
 */
export function matchesAcceptedAnswer(
  raw: unknown,
  accepted: readonly string[],
  options: ShortAnswerOptions = {},
): ShortAnswerMatch {
  if (typeof raw !== 'string') return 'undecidable';
  const cleaned = collapseWhitespace(raw);
  if (cleaned.length === 0) return 'mismatch';
  if (accepted.length === 0) return 'undecidable';

  const mode = options.comparison ?? inferComparisonMode(accepted);
  const withoutUnit = collapseWhitespace(stripUnit(cleaned, options.unit));

  if (mode === 'numeric') {
    const normalized = tightenFractionSlash(withoutUnit);
    if (isAmbiguous(normalized)) return 'undecidable';
    const given = parseRational(normalized);
    if (given === null) return 'mismatch';
    for (const candidate of accepted) {
      const key = parseRational(
        tightenFractionSlash(collapseWhitespace(stripUnit(candidate, options.unit))),
      );
      if (key !== null && sameRational(given, key)) return 'match';
    }
    return 'mismatch';
  }

  const normalize = (value: string) =>
    options.caseSensitive ? value : value.toLocaleLowerCase('es');
  const given = normalize(withoutUnit);
  for (const candidate of accepted) {
    if (normalize(collapseWhitespace(stripUnit(candidate, options.unit))) === given) return 'match';
  }
  return 'mismatch';
}
