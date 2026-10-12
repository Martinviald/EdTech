import {
  READING_STATES,
  TRANSCRIPTION_OUTPUT_KEYS,
  transcriptionOutputSchema,
  type ResponseFormat,
} from '@soe/types';
import { z } from 'zod';
import type { PartsJsonSchema } from './answer-format';
import { outputPartsSchemaFor } from './registry';

type JsonSchema = { readonly [key: string]: unknown };

export type TranscriptionOutputKey = (typeof TRANSCRIPTION_OUTPUT_KEYS)[number];

export interface TranscriptionJsonSchema {
  /** Identificador estable del esquema (cambia con las `parts` del formato). */
  readonly schemaId: string;
  readonly schema: {
    readonly type: 'object';
    readonly properties: Readonly<Record<TranscriptionOutputKey, JsonSchema>>;
    readonly required: readonly TranscriptionOutputKey[];
    readonly additionalProperties: false;
  };
  /** Orden de las propiedades: `characters` va antes de `literal` (contrato). */
  readonly propertyOrder: readonly TranscriptionOutputKey[];
}

export const TRANSCRIPTION_SCHEMA_VERSION = 1;

/** Familia de esquemas de salida que declaran los prompts de transcripción. */
export const TRANSCRIPTION_OUTPUT_SCHEMA_ID = `transcription-output@${TRANSCRIPTION_SCHEMA_VERSION}`;

const GENERIC_PARTS: JsonSchema = {
  type: ['object', 'null'],
  additionalProperties: { type: 'string' },
  description: 'Partes de la respuesta según el formato; null si no aplica',
};

function partsProperty(parts: PartsJsonSchema | null): JsonSchema {
  return parts === null
    ? { type: 'null', description: 'Este formato no usa partes: siempre null' }
    : parts;
}

function schemaShape(format: ResponseFormat): string {
  switch (format.kind) {
    case 'ordered_tuple':
      return `.${format.arity}`;
    case 'sequence':
      return `.${format.length}`;
    case 'fraction':
      return format.allowMixed ? '.mixed' : '';
    case 'word_list':
      return `.${format.count}`;
    case 'multi_box':
      return `.${format.boxes.map((box) => box.partId).join('+')}`;
    default:
      return '';
  }
}

function schemaIdFor(format: ResponseFormat): string {
  return `transcription-output.${format.kind}${schemaShape(format)}@${TRANSCRIPTION_SCHEMA_VERSION}`;
}

/**
 * JSON Schema plano de la salida del lector para un formato. Sin librerías: los
 * adaptadores de cada proveedor lo traducen a su dialecto (F3).
 */
export function transcriptionJsonSchema(format: ResponseFormat): TranscriptionJsonSchema {
  return buildSchema(schemaIdFor(format), partsProperty(outputPartsSchemaFor(format)));
}

/** Esquema base de la familia (partes genéricas): entra en el hash del lock de prompts. */
export function baseTranscriptionJsonSchema(): TranscriptionJsonSchema {
  return buildSchema(TRANSCRIPTION_OUTPUT_SCHEMA_ID, GENERIC_PARTS);
}

function buildSchema(schemaId: string, parts: JsonSchema): TranscriptionJsonSchema {
  const properties: Record<TranscriptionOutputKey, JsonSchema> = {
    characters: {
      type: 'array',
      description: 'Análisis de cada carácter, de izquierda a derecha, ANTES del literal',
      items: {
        type: 'object',
        properties: {
          shape: { type: 'string' },
          reading: { type: 'string' },
          alternatives: { type: 'array', items: { type: 'string' } },
        },
        required: ['shape', 'reading', 'alternatives'],
        additionalProperties: false,
      },
    },
    state: { type: 'string', enum: [...READING_STATES] },
    literal: { type: 'string', description: 'Transcripción literal; vacío si no hay respuesta' },
    parts,
    alternativeReadings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          literal: { type: 'string' },
          parts,
          plausibility: { type: 'number', description: 'Entre 0 y 1' },
        },
        required: ['literal', 'parts', 'plausibility'],
        additionalProperties: false,
      },
    },
    confidence: {
      type: 'number',
      description: 'Probabilidad entre 0 y 1 de que el literal sea exacto',
    },
    reviewRequested: {
      type: 'boolean',
      description: 'true si la casilla necesita que la revise una persona',
    },
    notes: { type: 'string', description: 'Una frase breve en español' },
  };
  const order = [...TRANSCRIPTION_OUTPUT_KEYS];
  return {
    schemaId,
    schema: {
      type: 'object',
      properties: Object.fromEntries(order.map((key) => [key, properties[key]])) as Record<
        TranscriptionOutputKey,
        JsonSchema
      >,
      required: order,
      additionalProperties: false,
    },
    propertyOrder: order,
  };
}

/** Esquema Zod de la salida para un formato: exige las `parts` que pide el formato. */
export function transcriptionZodSchema(format: ResponseFormat) {
  const parts = outputPartsSchemaFor(format);
  const partsSchema =
    parts === null
      ? z.null()
      : z.object(Object.fromEntries(parts.required.map((id) => [id, z.string()]))).strict();
  return transcriptionOutputSchema.extend({
    parts: partsSchema,
    alternativeReadings: z.array(
      z.object({ literal: z.string(), parts: partsSchema, plausibility: z.number().min(0).max(1) }),
    ),
  });
}
