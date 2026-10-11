import {
  isParsed,
  parseCanonicalKey,
  parseOrderedTupleText,
  parseScalarText,
  parseSequenceText,
  primaryReading,
  resolveNumberConvention,
  type CanonicalParse,
  type CanonicalValue,
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

function normalizeWith<K extends ResponseFormatKind>(
  output: TranscriptionOutput,
  spec: NormalizeSpec<K>,
): NormalizedAnswer {
  const base = { formatKind: spec.kind, state: output.state };
  if (output.state !== 'answered') {
    return { ...base, canonical: null, value: null, issues: [] };
  }
  const issues = new Set<NormalizationIssue>();
  if (output.literal.trim().length === 0 || spec.partsEmpty(output.parts)) issues.add('empty_part');
  const parse = spec.parse(output.literal);
  for (const issue of parse.issues) issues.add(issue);
  if (!isParsed(parse)) {
    return { ...base, canonical: null, value: null, issues: [...issues] };
  }
  const canonical = parseCanonicalKey(parse);
  const value = primaryReading(parse);
  if (value !== null) for (const issue of spec.formatIssues(value)) issues.add(issue);
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
  defaultCropProfileId: 'short-answer@1',
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
  defaultCropProfileId: 'short-answer@1',
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
  defaultCropProfileId: 'short-answer@1',
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
  defaultCropProfileId: 'short-answer@1',
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
  defaultCropProfileId: 'short-answer@1',
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

export const ANSWER_FORMATS: { readonly [K in SupportedFormatKind]: AnswerFormatDefinition<K> } = {
  integer: integerDefinition,
  decimal: decimalDefinition,
  fraction: fractionDefinition,
  ordered_tuple: orderedTupleDefinition,
  sequence: sequenceDefinition,
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

export function toScoringInput(normalized: NormalizedAnswer): unknown {
  if (!isSupportedFormatKind(normalized.formatKind)) {
    throw new Error(`El formato ${normalized.formatKind} no tiene definición`);
  }
  return ANSWER_FORMATS[normalized.formatKind].toScoringInput(normalized);
}
