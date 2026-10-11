import { z } from 'zod';
import { responseFormatKindSchema } from './response-format.schema';
import { readingStateSchema } from './transcription.schema';

// Respuesta normalizada: la clave y la transcripción se convierten a la MISMA
// estructura según el formato antes de compararse (§5.5, decisión D6). Así
// `1-2-3-4` y `1234`, o `2,5` y `2.5`, quedan iguales.
//
// Los números se representan como racional exacto con enteros en string (sin
// punto flotante): `2,5` → { numerator: "5", denominator: "2" } ya reducido.
// `written` conserva cómo lo escribió el alumno (para mostrar y agrupar), sin
// alterar dígitos ni separadores.

export const rationalSchema = z.object({
  numerator: z.string().regex(/^-?\d+$/),
  denominator: z.string().regex(/^[1-9]\d*$/),
});
export type Rational = z.infer<typeof rationalSchema>;

export const canonicalNumberSchema = z.object({
  type: z.literal('number'),
  value: rationalSchema,
  written: z.string(),
  decimalPlaces: z.number().int().nonnegative(),
});

export const canonicalFractionSchema = z.object({
  type: z.literal('fraction'),
  value: rationalSchema,
  written: z.object({
    whole: z.string().nullable(),
    numerator: z.string(),
    denominator: z.string(),
  }),
  isSimplified: z.boolean(),
});

export const canonicalScalarSchema = z.discriminatedUnion('type', [
  canonicalNumberSchema,
  canonicalFractionSchema,
]);
export type CanonicalScalar = z.infer<typeof canonicalScalarSchema>;

export const canonicalValueSchema = z.discriminatedUnion('type', [
  canonicalNumberSchema,
  canonicalFractionSchema,
  z.object({ type: z.literal('tuple'), components: z.array(canonicalScalarSchema).min(2) }),
  z.object({ type: z.literal('sequence'), elements: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal('word_list'), words: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('multi_box'),
    parts: z.record(
      z.string(),
      z.union([canonicalScalarSchema, z.object({ type: z.literal('text'), text: z.string() })]),
    ),
  }),
]);
export type CanonicalValue = z.infer<typeof canonicalValueSchema>;

export const NORMALIZATION_ISSUES = [
  'format_mismatch',
  'extra_tokens',
  'empty_part',
  'non_numeric_in_numeric',
  'parts_disagree_with_literal',
  'ambiguous_thousands_or_decimal',
  'unexpected_unit',
] as const;
export type NormalizationIssue = (typeof NORMALIZATION_ISSUES)[number];
export const normalizationIssueSchema = z.enum(NORMALIZATION_ISSUES);

// `canonical` es la clave estable para agrupar respuestas en la cola y comparar
// lecturas entre sí (dos lectores "coinciden" si su `canonical` es igual).
// Es `null` cuando la respuesta no se pudo convertir a la estructura del formato:
// eso NUNCA es incorrecta, va a revisión con motivo `unparsed_format`.
export const normalizedAnswerSchema = z.object({
  formatKind: responseFormatKindSchema,
  state: readingStateSchema,
  canonical: z.string().nullable(),
  value: canonicalValueSchema.nullable(),
  issues: z.array(normalizationIssueSchema),
});
export type NormalizedAnswer = z.infer<typeof normalizedAnswerSchema>;
