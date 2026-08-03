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

// ── Multi-selección (`multi_select`) ─────────────────────────────────────────
//
// Selección múltiple donde el alumno debe marcar VARIAS opciones. Reutiliza el
// shape de alternativas de `multiple_choice` a propósito: el render del banco y
// el análisis por ítem funcionan sin inventar una forma nueva. Lo que lo hace un
// tipo distinto es la SEMÁNTICA de corrección, no la del contenido — y por eso
// tiene su propio `type`, en vez de un flag dentro de multiple_choice: el tipo
// es lo que elige la estrategia de scoring.
//
// La invariante que lo separa de `multiple_choice` es tener **≥2 correctas**.

export const multiSelectContentSchema = z
  .object({
    stem: z.string().min(1),
    alternatives: z.array(alternativeSchema).min(3),
    ...baseContent,
  })
  .superRefine((content, ctx) => {
    const correct = content.alternatives.filter((alt) => alt.isCorrect).length;
    if (correct < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['alternatives'],
        message: `multi_select exige al menos 2 alternativas correctas (tiene ${correct}); con una sola es multiple_choice`,
      });
    }
    if (correct === content.alternatives.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['alternatives'],
        message: 'todas las alternativas son correctas: el ítem no discrimina',
      });
    }
    const keys = content.alternatives.map((alt) => alt.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['alternatives'],
        message: 'las keys de las alternativas deben ser únicas',
      });
    }
  });

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

// ── Términos pareados (`matching`) ───────────────────────────────────────────
//
// Abstracción genérica, NO una transcripción del formato DIA. Invariantes:
//
//   · `leftItems` es el lado RESPONDIBLE: cada elemento recibe exactamente una
//     respuesta del alumno, y por eso `correctPairs` tiene una entrada por
//     elemento y `leftId` es único. La corrección indexa por `leftId`.
//   · `rightItems` es el BANCO DE OPCIONES. Un elemento del banco que no aparece
//     en ningún `correctPairs` es, por definición, un distractor.
//   · `rightId` PUEDE repetirse: varios elementos respondibles pueden apuntar a
//     la misma opción (pareados de clasificación N → k categorías).
//   · Las dos columnas pueden tener tamaños distintos y arbitrarios.
//
// Qué lado del documento impreso queda en `leftItems` lo decide el adaptador de
// carga, no este schema: en unos instrumentos los distractores están en la
// columna A y en otros en la B. `label` preserva el rótulo impreso ("A.3") para
// no perder la traza al documento original.

const matchingElementSchema = z.object({
  id: z.string().min(1),
  /** Texto del elemento; si `isImage`, es la descripción textual de la figura. */
  text: z.string().min(1),
  /** Rótulo impreso en el documento de origen ("A.3", "1", "a"). Trazabilidad. */
  label: z.string().min(1).optional(),
  /** El contenido real es una figura — `text` la describe, no la reemplaza. */
  isImage: z.boolean().optional(),
});

export const matchingContentSchema = z
  .object({
    prompt: z.string().min(1).optional(),
    leftItems: z.array(matchingElementSchema).min(1),
    rightItems: z.array(matchingElementSchema).min(2),
    correctPairs: z.array(z.object({ leftId: z.string(), rightId: z.string() })).min(1),
    ...baseContent,
  })
  .superRefine((content, ctx) => {
    const leftIds = new Set(content.leftItems.map((el) => el.id));
    const rightIds = new Set(content.rightItems.map((el) => el.id));
    const seenLeftIds = new Set<string>();

    content.correctPairs.forEach((pair, index) => {
      if (!leftIds.has(pair.leftId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['correctPairs', index, 'leftId'],
          message: `leftId "${pair.leftId}" no existe en leftItems`,
        });
      }
      if (!rightIds.has(pair.rightId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['correctPairs', index, 'rightId'],
          message: `rightId "${pair.rightId}" no existe en rightItems`,
        });
      }
      if (seenLeftIds.has(pair.leftId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['correctPairs', index, 'leftId'],
          message: `leftId "${pair.leftId}" está repetido: cada elemento respondible admite un único par`,
        });
      }
      seenLeftIds.add(pair.leftId);
    });

    if (seenLeftIds.size !== leftIds.size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['correctPairs'],
        message: `correctPairs debe cubrir los ${leftIds.size} elementos de leftItems (cubre ${seenLeftIds.size})`,
      });
    }
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
  multi_select: multiSelectContentSchema,
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

export type MultiSelectContent = z.infer<typeof multiSelectContentSchema>;
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
  | MultiSelectContent
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
  'multi_select',
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
