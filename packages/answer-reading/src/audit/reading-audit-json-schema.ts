import { READING_AUDIT_OUTPUT_KEYS, type ReadingAuditOutputKey } from '@soe/types';

export const READING_AUDIT_SCHEMA_VERSION = 1;
/** Esquema de salida que declaran los prompts de auditoría de lectura. */
export const READING_AUDIT_OUTPUT_SCHEMA_ID = `reading-audit-output@${READING_AUDIT_SCHEMA_VERSION}`;

type JsonSchema = { readonly [key: string]: unknown };

export interface ReadingAuditJsonSchema {
  readonly schemaId: string;
  readonly schema: {
    readonly type: 'object';
    readonly properties: Readonly<Record<ReadingAuditOutputKey, JsonSchema>>;
    readonly required: readonly ReadingAuditOutputKey[];
    readonly additionalProperties: false;
  };
  readonly propertyOrder: readonly ReadingAuditOutputKey[];
}

/**
 * JSON Schema de la salida, idéntico al medido en `experimento-auditor`: la comparación
 * carácter por carácter va antes del veredicto.
 */
export function readingAuditJsonSchema(): ReadingAuditJsonSchema {
  const order = [...READING_AUDIT_OUTPUT_KEYS];
  return {
    schemaId: READING_AUDIT_OUTPUT_SCHEMA_ID,
    schema: {
      type: 'object',
      properties: {
        notes: {
          type: 'string',
          description: 'Trazos y comparación carácter por carácter, en español',
        },
        suspiciousCharacters: {
          type: 'array',
          items: { type: 'string' },
          description: 'Caracteres dudosos como "candidata → posible"',
        },
        verdict: { type: 'string', enum: ['approve', 'reject'] },
        confidence: {
          type: 'number',
          description: 'Probabilidad entre 0 y 1 de que el veredicto sea correcto',
        },
      },
      required: order,
      additionalProperties: false,
    },
    propertyOrder: order,
  };
}
