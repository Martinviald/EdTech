import {
  READING_STATES,
  TRANSCRIPTION_OUTPUT_KEYS,
  transcriptionOutputSchema,
  type ResponseFormat,
} from '@soe/types';
import { z } from 'zod';
import type { PartsJsonSchema } from './answer-format';
import { boxCellPartsSchema, boxCellSchemaShape } from './box-cells';
import { outputPartsSchemaFor } from './registry';
import type { ResponseGeometry } from './response-geometry';

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

export const BOX_CELLS_SCHEMA_VERSION = 1;

/** Familia de la lectura por casilla: una parte por casilla impresa (`box-cells.ts`). */
export const TRANSCRIPTION_BOX_CELLS_SCHEMA_ID = `transcription-cells@${BOX_CELLS_SCHEMA_VERSION}`;

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

function boxCellsSchemaIdFor(format: ResponseFormat, geometry: ResponseGeometry): string {
  return `transcription-cells.${format.kind}${boxCellSchemaShape(format, geometry)}@${BOX_CELLS_SCHEMA_VERSION}`;
}

function partsFor(format: ResponseFormat, cells: ResponseGeometry | null): PartsJsonSchema | null {
  return (
    (cells === null ? null : boxCellPartsSchema(format, cells)) ?? outputPartsSchemaFor(format)
  );
}

/**
 * JSON Schema plano de la salida del lector para un formato. Sin librerías: los
 * adaptadores de cada proveedor lo traducen a su dialecto (F3). Con `cells` (la
 * geometría impresa), es el de la lectura por casilla.
 */
export function transcriptionJsonSchema(
  format: ResponseFormat,
  cells: ResponseGeometry | null = null,
): TranscriptionJsonSchema {
  const schemaId = cells === null ? schemaIdFor(format) : boxCellsSchemaIdFor(format, cells);
  return buildSchema(schemaId, partsProperty(partsFor(format, cells)));
}

/** Esquema base de una familia (partes genéricas): entra en el hash del lock de prompts. */
export function baseTranscriptionJsonSchema(
  schemaId: string = TRANSCRIPTION_OUTPUT_SCHEMA_ID,
): TranscriptionJsonSchema {
  return buildSchema(schemaId, GENERIC_PARTS);
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
export function transcriptionZodSchema(
  format: ResponseFormat,
  cells: ResponseGeometry | null = null,
) {
  const parts = partsFor(format, cells);
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
