import {
  canonicalKey,
  isParsed,
  parseCanonicalKey,
  parseOrderedTupleText,
  parseScalarText,
  parseSequenceText,
  parseShortText,
  parseWordListText,
  primaryReading,
  resolveNumberConvention,
  type CanonicalParse,
  type CanonicalScalar,
  type CanonicalValue,
  type NumberConvention,
  type NormalizationIssue,
  type NormalizedAnswer,
  type ResponseFormat,
  type ResponseFormatKind,
  type TranscriptionOutput,
} from '@soe/types';
import {
  SUPPORTED_FORMAT_KINDS,
  type AnswerFormatDefinition,
  type FormatOf,
  type PartsJsonSchema,
  type SupportedFormatKind,
} from './answer-format';

type Parts = TranscriptionOutput['parts'];

function partsSchema(entries: ReadonlyArray<[string, string]>): PartsJsonSchema {
  return {
    type: 'object',
    properties: Object.fromEntries(
      entries.map(([id, description]) => [id, { type: 'string' as const, description }]),
    ),
    required: entries.map(([id]) => id),
    additionalProperties: false,
  };
}

function indexedIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
}

function partValues(parts: Parts, ids: readonly string[]): string[] | null {
  if (parts === null) return null;
  const values = ids.map((id) => (parts[id] ?? '').trim());
  return values.every((value) => value.length === 0) ? null : values;
}

function isNegative(value: CanonicalValue): boolean {
  return (
    (value.type === 'number' || value.type === 'fraction') && value.value.numerator.startsWith('-')
  );
}

interface NormalizeSpec<K extends ResponseFormatKind> {
  readonly kind: K;
  readonly parse: (text: string) => CanonicalParse;
  readonly partsLiteral: (parts: Parts) => string | null;
  readonly partsEmpty: (parts: Parts) => boolean;
  readonly formatIssues: (value: CanonicalValue) => NormalizationIssue[];
}

function comparableTokens(text: string): string[] {
  return (
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function isSubsequence(tokens: readonly string[], of: readonly string[]): boolean {
  let next = 0;
  for (const token of of) {
    if (next < tokens.length && tokens[next] === token) next += 1;
  }
  return next === tokens.length;
}

/**
 * Cómo se relaciona el literal con las partes cuando las partes mandan. Si el
 * literal da el mismo valor, no hay problema. Si solo trae una parte de lo que
 * dicen las partes (vacío, la primera casilla, el total, las palabras sin su
 * separador o con los signos impresos), se registra `literal_subset_of_parts`,
 * que no fuerza revisión. Si trae algo que las partes no dicen o en otro orden,
 * es una contradicción: `parts_disagree_with_literal`, que sí la fuerza.
 */
function literalIssue<K extends ResponseFormatKind>(
  literal: string,
  partsText: string,
  canonical: string,
  spec: NormalizeSpec<K>,
): NormalizationIssue | null {
  if (literal.trim().length > 0) {
    const parse = spec.parse(literal);
    if (isParsed(parse) && parseCanonicalKey(parse) === canonical) return null;
  }
  return isSubsequence(comparableTokens(literal), comparableTokens(partsText))
    ? 'literal_subset_of_parts'
    : 'parts_disagree_with_literal';
}

function interpreted<K extends ResponseFormatKind>(
  parse: CanonicalParse,
  spec: NormalizeSpec<K>,
  issues: Set<NormalizationIssue>,
): { canonical: string; value: CanonicalValue | null } {
  for (const issue of parse.issues) issues.add(issue);
  const value = primaryReading(parse);
  if (value !== null) for (const issue of spec.formatIssues(value)) issues.add(issue);
  return { canonical: parseCanonicalKey(parse) ?? '', value };
}

/** Partes completas y válidas: ninguna vacía y todas interpretables con su tipo. */
function usableParts<K extends ResponseFormatKind>(
  output: TranscriptionOutput,
  spec: NormalizeSpec<K>,
): { text: string; parse: CanonicalParse } | null {
  const text = spec.partsLiteral(output.parts);
  if (text === null || spec.partsEmpty(output.parts)) return null;
  const parse = spec.parse(text);
  if (!isParsed(parse) || parse.issues.includes('empty_part')) return null;
  return { text, parse };
}

/**
 * En los formatos con partes, las partes completas y válidas son la fuente de
 * verdad y el literal queda como control (`literalIssue`). Sin partes, o con
 * alguna vacía o no interpretable, se interpreta el literal como antes y las
 * partes solo marcan discrepancias.
 */
function normalizeWith<K extends ResponseFormatKind>(
  output: TranscriptionOutput,
  spec: NormalizeSpec<K>,
): NormalizedAnswer {
  const base = { formatKind: spec.kind, state: output.state };
  if (output.state !== 'answered') {
    return { ...base, canonical: null, value: null, issues: [] };
  }
  const issues = new Set<NormalizationIssue>();
  const parts = usableParts(output, spec);
  if (parts !== null) {
    const { canonical, value } = interpreted(parts.parse, spec, issues);
    const issue = literalIssue(output.literal, parts.text, canonical, spec);
    if (issue !== null) issues.add(issue);
    return { ...base, canonical, value, issues: [...issues] };
  }
  if (output.literal.trim().length === 0 || spec.partsEmpty(output.parts)) issues.add('empty_part');
  const parse = spec.parse(output.literal);
  if (!isParsed(parse)) {
    for (const issue of parse.issues) issues.add(issue);
    return { ...base, canonical: null, value: null, issues: [...issues] };
  }
  const { canonical, value } = interpreted(parse, spec, issues);
  const fromParts = spec.partsLiteral(output.parts);
  if (fromParts !== null && parseCanonicalKey(spec.parse(fromParts)) !== canonical) {
    issues.add('parts_disagree_with_literal');
  }
  return { ...base, canonical, value, issues: [...issues] };
}

function someEmpty(parts: Parts, ids: readonly string[]): boolean {
  const values = partValues(parts, ids);
  return values !== null && values.some((value) => value.length === 0);
}

function scalarText(value: CanonicalValue): string | null {
  if (value.type === 'number') return value.written;
  if (value.type === 'fraction') {
    const fraction = `${value.written.numerator}/${value.written.denominator}`;
    return value.written.whole === null ? fraction : `${value.written.whole} ${fraction}`;
  }
  return null;
}

function toScoringText(normalized: NormalizedAnswer): string | null {
  const value = normalized.value;
  if (normalized.state !== 'answered' || value === null || normalized.canonical === null) {
    return null;
  }
  if (value.type === 'tuple') {
    const separator = normalized.issues.includes('ambiguous_thousands_or_decimal') ? ',' : ';';
    return `(${value.components.map((component) => scalarText(component) ?? '').join(separator)})`;
  }
  if (value.type === 'sequence') return value.elements.join('; ');
  if (value.type === 'word_list') return value.words.join(', ');
  if (value.type === 'text') return value.text;
  return scalarText(value);
}

function scalarIssues(
  value: CanonicalValue,
  options: {
    allowNegative: boolean;
    expect: 'integer' | 'decimal' | 'fraction';
    allowMixed?: boolean;
  },
): NormalizationIssue[] {
  const issues: NormalizationIssue[] = [];
  if (!options.allowNegative && isNegative(value)) issues.push('format_mismatch');
  if (options.expect === 'fraction') {
    if (value.type !== 'fraction') issues.push('format_mismatch');
    else if (value.written.whole !== null && options.allowMixed === false) {
      issues.push('format_mismatch');
    }
    return issues;
  }
  if (value.type !== 'number') return [...issues, 'format_mismatch'];
  if (
    options.expect === 'integer' &&
    (value.decimalPlaces > 0 || value.value.denominator !== '1')
  ) {
    issues.push('format_mismatch');
  }
  return issues;
}

const SHORT_ANSWER_ONLY = ['short_answer'] as const;
const NUMERIC_NOTE =
  'Conserva el signo menos, la coma o el punto tal como están escritos y los ceros a la izquierda y a la derecha.';

function normalizeNumeric(
  kind: 'integer' | 'decimal',
  output: TranscriptionOutput,
  allowNegative: boolean,
): NormalizedAnswer {
  return normalizeWith(output, {
    kind,
    parse: (text) => resolveNumberConvention(parseScalarText(text), kind, 'answer'),
    partsLiteral: () => null,
    partsEmpty: () => false,
    formatIssues: (value) => scalarIssues(value, { allowNegative, expect: kind }),
  });
}

const integerDefinition: AnswerFormatDefinition<'integer'> = {
  kind: 'integer',
  readBy: 'vision',
  compatibleItemTypes: SHORT_ANSWER_ONLY,
  defaultCropProfileId: 'short-answer@2',
  gradedBy: 'key',
  formatLabel: () => 'número entero',
  promptGuide: () => `La respuesta es un número entero. ${NUMERIC_NOTE}`,
  outputPartsSchema: () => null,
  normalize: (output, format) => normalizeNumeric('integer', output, format.allowNegative),
  toScoringInput: toScoringText,
};

const decimalDefinition: AnswerFormatDefinition<'decimal'> = {
  kind: 'decimal',
  readBy: 'vision',
  compatibleItemTypes: SHORT_ANSWER_ONLY,
  defaultCropProfileId: 'short-answer@2',
  gradedBy: 'key',
  formatLabel: () => 'número decimal',
  promptGuide: () => `La respuesta es un número, posiblemente con decimales. ${NUMERIC_NOTE}`,
  outputPartsSchema: () => null,
  normalize: (output, format) => normalizeNumeric('decimal', output, format.allowNegative),
  toScoringInput: toScoringText,
};

const FRACTION_PARTS = ['whole', 'numerator', 'denominator'] as const;

const fractionDefinition: AnswerFormatDefinition<'fraction'> = {
  kind: 'fraction',
  readBy: 'vision',
  compatibleItemTypes: SHORT_ANSWER_ONLY,
  defaultCropProfileId: 'short-answer@2',
  gradedBy: 'key',
  formatLabel: (format) => (format.allowMixed ? 'fracción o número mixto' : 'fracción'),
  promptGuide: (format) =>
    [
      'La respuesta es una fracción. En "literal" escríbela como numerador/denominador (por ejemplo 3/4), aunque esté escrita en vertical.',
      format.allowMixed
        ? 'Si es un número mixto, escribe la parte entera, un espacio y la fracción (por ejemplo 1 1/2).'
        : '',
      'Repórtala también en "parts": "numerator" y "denominator", y en "whole" la parte entera si la hay (vacío si no). Conserva el signo menos tal como está.',
    ]
      .filter(Boolean)
      .join(' '),
  outputPartsSchema: () =>
    partsSchema([
      ['whole', 'Parte entera de un número mixto; vacío si no hay'],
      ['numerator', 'Numerador tal como está escrito'],
      ['denominator', 'Denominador tal como está escrito'],
    ]),
  normalize: (output, format) =>
    normalizeWith(output, {
      kind: 'fraction',
      parse: parseScalarText,
      partsLiteral: (parts) => {
        const values = partValues(parts, FRACTION_PARTS);
        if (values === null) return null;
        const [whole = '', numerator = '', denominator = ''] = values;
        return `${whole ? `${whole} ` : ''}${numerator}/${denominator}`;
      },
      partsEmpty: (parts) => someEmpty(parts, ['numerator', 'denominator']),
      formatIssues: (value) =>
        scalarIssues(value, {
          allowNegative: format.allowNegative,
          expect: 'fraction',
          allowMixed: format.allowMixed,
        }),
    }),
  toScoringInput: toScoringText,
};

function tupleLabel(arity: number): string {
  if (arity === 2) return 'par ordenado';
  if (arity === 3) return 'terna ordenada';
  return `${arity} valores ordenados`;
}

const orderedTupleDefinition: AnswerFormatDefinition<'ordered_tuple'> = {
  kind: 'ordered_tuple',
  readBy: 'vision',
  compatibleItemTypes: SHORT_ANSWER_ONLY,
  defaultCropProfileId: 'short-answer@2',
  gradedBy: 'key',
  formatLabel: (format) => tupleLabel(format.arity),
  promptGuide: (format) =>
    `La respuesta es un ${tupleLabel(format.arity)} de ${format.arity} valores. Copia en "literal" lo escrito con sus paréntesis y separadores, y reporta cada valor en "parts" (${indexedIds('c', format.arity).join(', ')}), en el orden en que está escrito.`,
  outputPartsSchema: (format) =>
    partsSchema(
      indexedIds('c', format.arity).map((id, index) => [
        id,
        `Valor ${index + 1} en el orden escrito`,
      ]),
    ),
  normalize: (output, format) => {
    const ids = indexedIds('c', format.arity);
    return normalizeWith(output, {
      kind: 'ordered_tuple',
      parse: (text) => parseOrderedTupleText(text, format.arity),
      partsLiteral: (parts) => {
        const values = partValues(parts, ids);
        return values === null ? null : `(${values.join(';')})`;
      },
      partsEmpty: (parts) => someEmpty(parts, ids),
      formatIssues: (value) =>
        value.type === 'tuple' &&
        format.componentKind === 'integer' &&
        value.components.some((component) => component.value.denominator !== '1')
          ? ['format_mismatch']
          : [],
    });
  },
  toScoringInput: toScoringText,
};

/** Igual que la corrección de CSV: `12` en una secuencia de 2 puede ser el número 12. */
const MIN_PASTED_SEQUENCE_LENGTH = 3;

const sequenceDefinition: AnswerFormatDefinition<'sequence'> = {
  kind: 'sequence',
  readBy: 'vision',
  compatibleItemTypes: ['short_answer', 'ordering'],
  defaultCropProfileId: 'short-answer@2',
  gradedBy: 'key',
  formatLabel: (format) => `secuencia de ${format.length} elementos`,
  promptGuide: (format) =>
    `La respuesta es una secuencia de ${format.length} elementos. Copia en "literal" lo escrito con sus separadores, y reporta cada elemento en "parts" (${indexedIds('e', format.length).join(', ')}), en el orden en que está escrito.`,
  outputPartsSchema: (format) =>
    partsSchema(
      indexedIds('e', format.length).map((id, index) => [
        id,
        `Elemento ${index + 1} en el orden escrito`,
      ]),
    ),
  normalize: (output, format) => {
    const ids = indexedIds('e', format.length);
    const parse = (text: string) =>
      parseSequenceText(text, {
        expectedLength: format.length,
        allowPasted: format.length >= MIN_PASTED_SEQUENCE_LENGTH,
      });
    return normalizeWith(output, {
      kind: 'sequence',
      parse,
      partsLiteral: (parts) => {
        const values = partValues(parts, ids);
        return values === null ? null : values.join(';');
      },
      partsEmpty: (parts) => someEmpty(parts, ids),
      formatIssues: () => [],
    });
  },
  toScoringInput: toScoringText,
};

const SHORT_TEXT_NOTE =
  'Copia exactamente lo escrito, con sus mayúsculas, tildes, puntuación y faltas de ortografía. No corrijas, no completes y no traduzcas.';

const wordListDefinition: AnswerFormatDefinition<'word_list'> = {
  kind: 'word_list',
  readBy: 'vision',
  compatibleItemTypes: SHORT_ANSWER_ONLY,
  defaultCropProfileId: 'free-text@2',
  gradedBy: 'key',
  formatLabel: (format) =>
    format.count === 1 ? 'una palabra' : `lista de ${format.count} palabras`,
  promptGuide: (format) =>
    [
      `La respuesta es una lista de ${format.count === 1 ? 'una palabra' : `${format.count} palabras`}.`,
      SHORT_TEXT_NOTE,
      'En "literal" escribe las palabras en el orden en que están escritas, separadas por coma y espacio, aunque el estudiante haya usado otro separador o un renglón por palabra.',
      `Repórtalas también en "parts", una por parte (${indexedIds('w', format.count).join(', ')}), en el mismo orden; deja vacías las que no se usen. Si hay más palabras que partes, inclúyelas todas en "literal".`,
    ].join(' '),
  outputPartsSchema: (format) =>
    partsSchema(
      indexedIds('w', format.count).map((id, index) => [
        id,
        `Palabra ${index + 1} en el orden escrito; vacío si no hay`,
      ]),
    ),
  normalize: (output, format) => {
    const ids = indexedIds('w', format.count);
    return normalizeWith(output, {
      kind: 'word_list',
      parse: (text) => parseWordListText(text, { expectedCount: format.count }),
      partsLiteral: (parts) => {
        const values = partValues(parts, ids);
        return values === null ? null : values.filter((value) => value.length > 0).join(', ');
      },
      partsEmpty: () => false,
      formatIssues: () => [],
    });
  },
  toScoringInput: toScoringText,
};

const shortTextDefinition: AnswerFormatDefinition<'short_text'> = {
  kind: 'short_text',
  readBy: 'vision',
  compatibleItemTypes: SHORT_ANSWER_ONLY,
  defaultCropProfileId: 'free-text@2',
  gradedBy: 'key',
  formatLabel: () => 'texto corto',
  promptGuide: (format) =>
    `La respuesta es un texto corto, de hasta ${format.maxWords} palabras. ${SHORT_TEXT_NOTE} Si ocupa más de un renglón, únelos con un espacio.`,
  outputPartsSchema: () => null,
  normalize: (output) =>
    normalizeWith(output, {
      kind: 'short_text',
      parse: parseShortText,
      partsLiteral: () => null,
      partsEmpty: () => false,
      formatIssues: () => [],
    }),
  toScoringInput: toScoringText,
};

type MultiBox = FormatOf<'multi_box'>;
type BoxSpec = MultiBox['boxes'][number];
type BoxValue = Extract<CanonicalValue, { type: 'multi_box' }>['parts'][string];

const MULTI_BOX_SEPARATOR = '|';
const BOX_KIND_LABEL: Record<BoxSpec['kind'], string> = {
  integer: 'número entero',
  decimal: 'número',
  fraction: 'fracción, escrita numerador/denominador',
  short_text: 'texto',
};

function boxReadings(
  segment: string,
  box: BoxSpec,
  issues: Set<NormalizationIssue>,
): Record<NumberConvention, BoxValue | null> {
  if (segment.length === 0) {
    issues.add('empty_part');
    const empty: BoxValue = { type: 'text', text: '' };
    return { decimal: empty, thousands: empty };
  }
  if (box.kind === 'short_text') {
    const value = primaryReading(parseShortText(segment));
    return { decimal: value, thousands: value };
  }
  const parse = resolveNumberConvention(parseScalarText(segment), box.kind, 'answer');
  for (const issue of parse.issues) issues.add(issue);
  const first = (values: CanonicalScalar[]) => values[0] ?? null;
  const readings = {
    decimal: first(parse.readings.decimal),
    thousands: first(parse.readings.thousands),
  };
  const value = readings.decimal ?? readings.thousands;
  if (value !== null) {
    const expect = box.kind === 'fraction' ? 'fraction' : box.kind;
    for (const issue of scalarIssues(value, { allowNegative: true, expect })) issues.add(issue);
  }
  return readings;
}

/**
 * Varias casillas: el literal trae el contenido de cada una en orden, separado por
 * `|`. Cada casilla se interpreta con el parser de su tipo; una casilla vacía es
 * una parte vacía (va a revisión). Si la cantidad de casillas no calza, no se
 * interpreta.
 */
function parseMultiBoxText(text: string, format: MultiBox): CanonicalParse {
  const segments = text.split(MULTI_BOX_SEPARATOR).map((segment) => segment.trim());
  if (segments.length !== format.boxes.length) {
    return { readings: { decimal: [], thousands: [] }, issues: ['format_mismatch'] };
  }
  const issues = new Set<NormalizationIssue>();
  const byConvention: Record<NumberConvention, Record<string, BoxValue> | null> = {
    decimal: {},
    thousands: {},
  };
  format.boxes.forEach((box, index) => {
    const readings = boxReadings(segments[index] ?? '', box, issues);
    for (const convention of ['decimal', 'thousands'] as const) {
      const parts = byConvention[convention];
      const value = readings[convention];
      if (parts === null) continue;
      if (value === null) byConvention[convention] = null;
      else parts[box.partId] = value;
    }
  });
  const reading = (convention: NumberConvention): CanonicalValue[] => {
    const parts = byConvention[convention];
    return parts === null ? [] : [{ type: 'multi_box', parts }];
  };
  const readings = { decimal: reading('decimal'), thousands: reading('thousands') };
  if (readings.decimal.length === 0 && readings.thousands.length === 0) {
    issues.add('non_numeric_in_numeric');
  }
  return { readings, issues: [...issues] };
}

function boxText(value: BoxValue): string {
  return value.type === 'text' ? value.text : (scalarText(value) ?? '');
}

const multiBoxDefinition: AnswerFormatDefinition<'multi_box'> = {
  kind: 'multi_box',
  readBy: 'vision',
  compatibleItemTypes: ['gap_fill'],
  defaultCropProfileId: 'short-answer@2',
  gradedBy: 'key',
  formatLabel: (format) =>
    `${format.boxes.length} casillas: ${format.boxes.map((box) => box.label).join(', ')}`,
  promptGuide: (format) =>
    [
      `La respuesta tiene ${format.boxes.length} casillas, en este orden: ${format.boxes
        .map((box) => `"${box.label}" (${BOX_KIND_LABEL[box.kind]})`)
        .join(', ')}.`,
      `En "literal" escribe el contenido de cada casilla en ese orden, separado por " ${MULTI_BOX_SEPARATOR} ", sin los rótulos impresos; si una casilla está en blanco, deja vacío su lugar entre las barras.`,
      `Repórtalo también en "parts", con el identificador de cada casilla (${format.boxes
        .map((box) => box.partId)
        .join(', ')}).`,
      SHORT_TEXT_NOTE,
      NUMERIC_NOTE,
    ].join(' '),
  outputPartsSchema: (format) =>
    partsSchema(
      format.boxes.map((box) => [
        box.partId,
        `Contenido de la casilla "${box.label}"; vacío si no hay`,
      ]),
    ),
  normalize: (output, format) => {
    const ids = format.boxes.map((box) => box.partId);
    return normalizeWith(output, {
      kind: 'multi_box',
      parse: (text) => parseMultiBoxText(text, format),
      partsLiteral: (parts) => {
        const values = partValues(parts, ids);
        return values === null ? null : values.join(` ${MULTI_BOX_SEPARATOR} `);
      },
      partsEmpty: () => false,
      formatIssues: () => [],
    });
  },
  toScoringInput: (normalized) => {
    const value = normalized.value;
    if (normalized.state !== 'answered' || value === null || normalized.canonical === null) {
      return null;
    }
    if (value.type !== 'multi_box') return null;
    return Object.fromEntries(
      Object.entries(value.parts).map(([partId, part]) => [partId, boxText(part)]),
    );
  },
};

const RUBRIC_ITEM_TYPES = ['rubric_scored', 'writing', 'open_ended'] as const;

/** Texto transcrito para la rúbrica: renglones sin espacios sobrantes, sin estructura. */
function normalizeTranscribedText(
  kind: 'free_text' | 'math_work',
  output: TranscriptionOutput,
): NormalizedAnswer {
  const base = { formatKind: kind, state: output.state };
  if (output.state !== 'answered') return { ...base, canonical: null, value: null, issues: [] };
  const text = output.literal
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length === 0) return { ...base, canonical: null, value: null, issues: ['empty_part'] };
  const value: CanonicalValue = { type: 'text', text };
  return { ...base, canonical: canonicalKey(value), value, issues: [] };
}

const FREE_TEXT_NOTE =
  'Copia todo lo escrito, en orden, respetando los saltos de renglón (usa \\n entre renglones). Conserva las faltas de ortografía, las mayúsculas y la puntuación tal como están: no corrijas, no completes, no resumas y no evalúes. Si una palabra o un trozo no se puede leer, escribe [ilegible] en su lugar. Omite lo tachado.';

const freeTextDefinition: AnswerFormatDefinition<'free_text'> = {
  kind: 'free_text',
  readBy: 'vision',
  compatibleItemTypes: RUBRIC_ITEM_TYPES,
  defaultCropProfileId: 'free-text@2',
  gradedBy: 'rubric',
  formatLabel: () => 'respuesta de desarrollo',
  promptGuide: (format) =>
    `La respuesta es un texto de desarrollo de hasta ${format.lines} renglones. ${FREE_TEXT_NOTE}`,
  outputPartsSchema: () => null,
  normalize: (output) => normalizeTranscribedText('free_text', output),
  toScoringInput: toScoringText,
};

const mathWorkDefinition: AnswerFormatDefinition<'math_work'> = {
  kind: 'math_work',
  readBy: 'vision',
  compatibleItemTypes: RUBRIC_ITEM_TYPES,
  defaultCropProfileId: 'free-text@2',
  gradedBy: 'rubric',
  formatLabel: () => 'desarrollo matemático',
  promptGuide: () =>
    `La respuesta es un procedimiento matemático: operaciones, cálculos y el resultado. ${FREE_TEXT_NOTE} Escribe cada renglón del procedimiento con la notación de salida (fracciones como numerador/denominador, exponentes con ^) y conserva los errores de cálculo tal como están.`,
  outputPartsSchema: () => null,
  normalize: (output) => normalizeTranscribedText('math_work', output),
  toScoringInput: toScoringText,
};

export const ANSWER_FORMATS: { readonly [K in SupportedFormatKind]: AnswerFormatDefinition<K> } = {
  integer: integerDefinition,
  decimal: decimalDefinition,
  fraction: fractionDefinition,
  ordered_tuple: orderedTupleDefinition,
  sequence: sequenceDefinition,
  word_list: wordListDefinition,
  short_text: shortTextDefinition,
  multi_box: multiBoxDefinition,
  free_text: freeTextDefinition,
  math_work: mathWorkDefinition,
};

export function isSupportedFormatKind(kind: ResponseFormatKind): kind is SupportedFormatKind {
  return (SUPPORTED_FORMAT_KINDS as readonly ResponseFormatKind[]).includes(kind);
}

export function isSupportedFormat(format: ResponseFormat): format is FormatOf<SupportedFormatKind> {
  return isSupportedFormatKind(format.kind);
}

/** Definición del formato; lanza si el formato todavía no está en el registro. */
export function answerFormatFor(format: ResponseFormat): {
  definition: AnswerFormatDefinition<SupportedFormatKind>;
  format: FormatOf<SupportedFormatKind>;
} {
  if (!isSupportedFormat(format)) throw new Error(`El formato ${format.kind} no tiene definición`);
  const definition = ANSWER_FORMATS[
    format.kind
  ] as unknown as AnswerFormatDefinition<SupportedFormatKind>;
  return { definition, format };
}

export function normalizeTranscription(
  output: TranscriptionOutput,
  format: ResponseFormat,
): NormalizedAnswer {
  const supported = answerFormatFor(format);
  return supported.definition.normalize(output, supported.format);
}

export function formatLabelFor(format: ResponseFormat): string {
  const supported = answerFormatFor(format);
  return supported.definition.formatLabel(supported.format);
}

export function promptGuideFor(format: ResponseFormat): string {
  const supported = answerFormatFor(format);
  return supported.definition.promptGuide(supported.format);
}

export function outputPartsSchemaFor(format: ResponseFormat): PartsJsonSchema | null {
  const supported = answerFormatFor(format);
  return supported.definition.outputPartsSchema(supported.format);
}

/** `true` si el formato se califica con rúbrica: el consenso nunca lo autoacepta. */
export function requiresRubricGrading(format: ResponseFormat): boolean {
  return isSupportedFormat(format) && ANSWER_FORMATS[format.kind].gradedBy === 'rubric';
}

export function toScoringInput(normalized: NormalizedAnswer): unknown {
  if (!isSupportedFormatKind(normalized.formatKind)) {
    throw new Error(`El formato ${normalized.formatKind} no tiene definición`);
  }
  return ANSWER_FORMATS[normalized.formatKind].toScoringInput(normalized);
}
