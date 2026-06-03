import { z } from 'zod';
import type { ItemType } from '../enums';
// `multiple_choice` ya tiene su schema canónico en item.schema.ts. Lo reutilizamos
// para no duplicar la definición ni colisionar en el re-export del índice.
import { multipleChoiceContentSchema, type MultipleChoiceContent } from './item.schema';

// ─────────────────────────────────────────────────────────────────────────────
// CONTRATO FASE 0 — Contenido polimórfico de ítems (fix/flexibilidad-arquitectura)
//
// Este archivo es el ÚNICO tipo compartido entre oleadas: lo define la Oleada A
// (#5) y lo consumen la Oleada B (#1 scoring, #4 dia-ingestion). Define un schema
// Zod de `content` por cada valor de `item_type`, un registro `ITEM_CONTENT_SCHEMAS`
// y un validador `validateItemContent(type, content)`.
//
// REGLA DE EXTENSIBILIDAD: agregar un tipo de pregunta nuevo = agregar (a) el valor
// al enum `item_type`, (b) su schema de content aquí, (c) su entrada en el registro,
// (d) su estrategia de scoring (ver scoring-strategy.ts). Cero tablas nuevas.
//
// Los shapes de Fase 0 son el contrato base. La Oleada A puede AFINARLOS (campos
// requeridos, validaciones), pero NO romper las claves públicas ni el nombre del
// registro/validador, porque #1 y #4 compilan contra ellos.
// ─────────────────────────────────────────────────────────────────────────────

// ── Bloques reutilizables ────────────────────────────────────────────────────

const alternativeSchema = z.object({
  key: z.string().min(1).max(5),
  text: z.string().min(1),
  isCorrect: z.boolean(),
});

const baseContent = {
  imageUrl: z.string().url().optional(),
  audioUrl: z.string().url().optional(),
  explanation: z.string().optional(),
};

// ── Schemas de content por tipo ──────────────────────────────────────────────
// (multiple_choice se importa de item.schema.ts — ver arriba)

export const trueFalseContentSchema = z.object({
  stem: z.string().min(1),
  correctAnswer: z.boolean(),
  ...baseContent,
});

export const openEndedContentSchema = z.object({
  prompt: z.string().min(1),
  maxWords: z.number().int().positive().optional(),
  sampleAnswer: z.string().optional(),
  rubricId: z.string().uuid().optional(),
  ...baseContent,
});

export const writingContentSchema = z.object({
  prompt: z.string().min(1),
  minWords: z.number().int().positive().optional(),
  maxWords: z.number().int().positive().optional(),
  rubricId: z.string().uuid().optional(),
  ...baseContent,
});

export const oralReadingContentSchema = z.object({
  passage: z.string().min(1),
  rubricId: z.string().uuid().optional(),
  ...baseContent,
});

export const oralExpressionContentSchema = z.object({
  prompt: z.string().min(1),
  rubricId: z.string().uuid().optional(),
  ...baseContent,
});

export const listeningContentSchema = z.object({
  audioUrl: z.string().url(),
  stem: z.string().min(1),
  alternatives: z.array(alternativeSchema).min(2).optional(),
  explanation: baseContent.explanation,
  imageUrl: baseContent.imageUrl,
});

export const matchingContentSchema = z.object({
  prompt: z.string().min(1).optional(),
  leftItems: z.array(z.object({ id: z.string(), text: z.string().min(1) })).min(2),
  rightItems: z.array(z.object({ id: z.string(), text: z.string().min(1) })).min(2),
  correctPairs: z.array(z.object({ leftId: z.string(), rightId: z.string() })).min(1),
  ...baseContent,
});

export const orderingContentSchema = z.object({
  prompt: z.string().min(1).optional(),
  items: z.array(z.object({ id: z.string(), text: z.string().min(1) })).min(2),
  correctOrder: z.array(z.string()).min(2),
  ...baseContent,
});

export const gapFillContentSchema = z.object({
  textWithGaps: z.string().min(1),
  gaps: z
    .array(
      z.object({
        position: z.number().int().min(0),
        acceptedAnswers: z.array(z.string().min(1)).min(1),
        caseSensitive: z.boolean().optional(),
      }),
    )
    .min(1),
  ...baseContent,
});

// ── Registro tipo → schema (punto de extensión único) ────────────────────────

export const ITEM_CONTENT_SCHEMAS = {
  multiple_choice: multipleChoiceContentSchema,
  true_false: trueFalseContentSchema,
  open_ended: openEndedContentSchema,
  writing: writingContentSchema,
  oral_reading: oralReadingContentSchema,
  oral_expression: oralExpressionContentSchema,
  listening: listeningContentSchema,
  matching: matchingContentSchema,
  ordering: orderingContentSchema,
  gap_fill: gapFillContentSchema,
} satisfies Record<ItemType, z.ZodTypeAny>;

// ── Tipos derivados ──────────────────────────────────────────────────────────

export type TrueFalseContent = z.infer<typeof trueFalseContentSchema>;
export type OpenEndedContent = z.infer<typeof openEndedContentSchema>;
export type WritingContent = z.infer<typeof writingContentSchema>;
export type OralReadingContent = z.infer<typeof oralReadingContentSchema>;
export type OralExpressionContent = z.infer<typeof oralExpressionContentSchema>;
export type ListeningContent = z.infer<typeof listeningContentSchema>;
export type MatchingContent = z.infer<typeof matchingContentSchema>;
export type OrderingContent = z.infer<typeof orderingContentSchema>;
export type GapFillContent = z.infer<typeof gapFillContentSchema>;

/** Unión de todos los contenidos posibles. Tipo a usar en `items.content.$type<ItemContent>()`. */
export type ItemContent =
  | MultipleChoiceContent
  | TrueFalseContent
  | OpenEndedContent
  | WritingContent
  | OralReadingContent
  | OralExpressionContent
  | ListeningContent
  | MatchingContent
  | OrderingContent
  | GapFillContent;

// ── Auto-scorabilidad (contrato para el registro de scoring, #1) ─────────────
// Tipos que una máquina puede corregir determinísticamente. El resto requiere
// corrección humana/IA (ai_grading_jobs en F4) → el scoring los marca pendientes,
// NUNCA los puntúa 0 en silencio.

export const AUTO_SCORABLE_ITEM_TYPES = [
  'multiple_choice',
  'true_false',
  'matching',
  'ordering',
  'gap_fill',
] as const satisfies readonly ItemType[];

export function isAutoScorable(type: ItemType): boolean {
  return (AUTO_SCORABLE_ITEM_TYPES as readonly ItemType[]).includes(type);
}

// ── Validador ────────────────────────────────────────────────────────────────

/**
 * Valida y parsea el `content` de un ítem contra el schema de su `type`.
 * Lanza ZodError si no cumple. La capa de aplicación (items.service) decide si
 * propagar como BadRequest.
 */
export function validateItemContent(type: ItemType, content: unknown): ItemContent {
  const schema = ITEM_CONTENT_SCHEMAS[type];
  return schema.parse(content) as ItemContent;
}

/** Variante segura: devuelve el resultado de Zod sin lanzar. */
export function safeValidateItemContent(type: ItemType, content: unknown) {
  return ITEM_CONTENT_SCHEMAS[type].safeParse(content);
}
