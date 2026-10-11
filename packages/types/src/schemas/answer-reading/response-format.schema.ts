import { z } from 'zod';

// Formato de respuesta de un ítem abierto: decide cómo se imprime la casilla, qué
// esquema y prompt usa el lector, cómo se normaliza y qué estrategia corrige.
// Diseño: docs/diseno-correccion-vision-preguntas-abiertas.md §5.

export const RESPONSE_FORMAT_KINDS = [
  'integer',
  'decimal',
  'fraction',
  'ordered_tuple',
  'sequence',
  'word_list',
  'short_text',
  'multi_box',
  'free_text',
  'math_work',
  'bubble_choice',
  'score_bubbles',
] as const;
export type ResponseFormatKind = (typeof RESPONSE_FORMAT_KINDS)[number];
export const responseFormatKindSchema = z.enum(RESPONSE_FORMAT_KINDS);

export const READ_BY = ['vision', 'omr'] as const;
export type ReadBy = (typeof READ_BY)[number];

export const MULTI_BOX_PART_KINDS = ['integer', 'decimal', 'fraction', 'short_text'] as const;

export const responseFormatSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('integer'),
      maxChars: z.number().int().min(1).max(12),
      allowNegative: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('decimal'),
      maxChars: z.number().int().min(1).max(12),
      allowNegative: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('fraction'),
      allowNegative: z.boolean(),
      allowMixed: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('ordered_tuple'),
      arity: z.number().int().min(2).max(4),
      componentKind: z.enum(['integer', 'decimal', 'fraction']),
    })
    .strict(),
  z.object({ kind: z.literal('sequence'), length: z.number().int().min(2).max(12) }).strict(),
  z.object({ kind: z.literal('word_list'), count: z.number().int().min(1).max(10) }).strict(),
  z.object({ kind: z.literal('short_text'), maxWords: z.number().int().min(1).max(40) }).strict(),
  z
    .object({
      kind: z.literal('multi_box'),
      boxes: z
        .array(
          z
            .object({
              partId: z.string().min(1),
              label: z.string().min(1),
              kind: z.enum(MULTI_BOX_PART_KINDS),
            })
            .strict(),
        )
        .min(2),
    })
    .strict(),
  z.object({ kind: z.literal('free_text'), lines: z.number().int().min(1).max(30) }).strict(),
  z.object({ kind: z.literal('math_work'), heightRatio: z.number().min(0.05).max(1) }).strict(),
  z.object({ kind: z.literal('bubble_choice') }).strict(),
  z
    .object({ kind: z.literal('score_bubbles'), levels: z.array(z.string().min(1)).min(2) })
    .strict(),
]);
export type ResponseFormat = z.infer<typeof responseFormatSchema>;

// Equivalencias de corrección (§5.5, decisión D6). Todas opcionales: lo que falta
// toma el valor por defecto del formato (DEFAULT_EQUIVALENCES). La pauta del ítem
// siempre manda sobre el valor por defecto.
export const equivalencesSchema = z
  .object({
    requireExactDecimals: z.boolean().optional(),
    tolerance: z.number().nonnegative().optional(),
    requireSimplified: z.boolean().optional(),
    acceptDecimalEquivalent: z.boolean().optional(),
    acceptEquivalentFractions: z.boolean().optional(),
    ignoreUnit: z.boolean().optional(),
    unordered: z.boolean().optional(),
  })
  .strict();
export type Equivalences = z.infer<typeof equivalencesSchema>;

export const DEFAULT_EQUIVALENCES: Required<Equivalences> = {
  requireExactDecimals: false,
  tolerance: 0,
  requireSimplified: false,
  acceptDecimalEquivalent: false,
  acceptEquivalentFractions: true,
  ignoreUnit: true,
  unordered: false,
};

// Crédito parcial por componente (pares ordenados) o por casilla (multi_box).
// Solo existe si la pauta del ítem lo indica (D6): ausente = todo o nada.
export const componentCreditSchema = z
  .object({
    mode: z.literal('per_component'),
    creditPerComponent: z.array(z.number().min(0).max(1)).min(2),
  })
  .strict();
export type ComponentCredit = z.infer<typeof componentCreditSchema>;
