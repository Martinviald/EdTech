import {
  VERIFICATION_OUTPUT_KEYS,
  verificationOutputSchema,
  type VerificationOutputKey,
} from '@soe/types';
import type { ZodTypeAny } from 'zod';

export const VERIFICATION_SCHEMA_VERSION = 1;

/** Esquema de salida que declaran los prompts de verificación de incorrectas. */
export const VERIFICATION_OUTPUT_SCHEMA_ID = `verification-output@${VERIFICATION_SCHEMA_VERSION}`;

type JsonSchema = { readonly [key: string]: unknown };

export interface VerificationJsonSchema {
  readonly schemaId: string;
  readonly schema: {
    readonly type: 'object';
    readonly properties: Readonly<Record<VerificationOutputKey, JsonSchema>>;
    readonly required: readonly VerificationOutputKey[];
    readonly additionalProperties: false;
  };
  readonly propertyOrder: readonly VerificationOutputKey[];
}

/** JSON Schema de la salida: la comparación trazo por trazo va antes del veredicto. */
export function verificationJsonSchema(): VerificationJsonSchema {
  const order = [...VERIFICATION_OUTPUT_KEYS];
  return {
    schemaId: VERIFICATION_OUTPUT_SCHEMA_ID,
    schema: {
      type: 'object',
      properties: {
        notes: {
          type: 'string',
          description: 'Trazos de cada carácter y comparación carácter por carácter, en español',
        },
        differingCharacters: {
          type: 'array',
          items: { type: 'string' },
          description: 'Caracteres que difieren, como "lectura → respuesta correcta"',
        },
        couldBeKey: {
          type: 'boolean',
          description: 'true si lo escrito podría ser una respuesta correcta mal leída',
        },
        confidence: {
          type: 'number',
          description: 'Probabilidad entre 0 y 1 de que la decisión sea la correcta',
        },
      },
      required: order,
      additionalProperties: false,
    },
    propertyOrder: order,
  };
}

export function verificationZodSchema(): ZodTypeAny {
  return verificationOutputSchema;
}
