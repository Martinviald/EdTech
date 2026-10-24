import type { InterpretedReading, InterpretedReadingState } from '@soe/types';
import { z } from 'zod';

// Salida del lector que interpreta (`transcribe.interpret@1`). Las claves van en español
// porque son las que lee el modelo; el código trabaja con `InterpretedReading`. El esquema
// es el medido en la prueba de concepto del 2026-10-23 sobre 1.000 recortes: cambiarlo
// invalida el caché y exige medir de nuevo.

export const INTERPRETATION_OUTPUT_SCHEMA_ID = 'interpretation-output@1';

export const INTERPRETATION_PROPERTY_ORDER = [
  'literal',
  'estado',
  'respuesta',
  'candidatos',
  'confianza',
] as const;

export const INTERPRETATION_MODEL_STATES = [
  'respondida',
  'ambigua',
  'en_blanco',
  'ilegible',
] as const;
export type InterpretationModelState = (typeof INTERPRETATION_MODEL_STATES)[number];

export interface InterpretationJsonSchema {
  readonly schemaId: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly propertyOrder: readonly string[];
}

export function interpretationJsonSchema(): InterpretationJsonSchema {
  return {
    schemaId: INTERPRETATION_OUTPUT_SCHEMA_ID,
    schema: {
      type: 'object',
      properties: {
        literal: { type: 'string', description: 'Lo escrito, exactamente' },
        estado: { type: 'string', enum: [...INTERPRETATION_MODEL_STATES] },
        respuesta: {
          type: 'string',
          description: 'La respuesta que quiso dar; vacía si no aplica',
        },
        candidatos: { type: 'array', items: { type: 'string' } },
        confianza: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: [...INTERPRETATION_PROPERTY_ORDER],
      additionalProperties: false,
    },
    propertyOrder: INTERPRETATION_PROPERTY_ORDER,
  };
}

export const interpretationOutputSchema = z.object({
  literal: z.string(),
  estado: z.enum(INTERPRETATION_MODEL_STATES),
  respuesta: z.string(),
  candidatos: z.array(z.string()),
  confianza: z.number().min(0).max(1),
});
export type InterpretationOutput = z.infer<typeof interpretationOutputSchema>;

const STATE_BY_MODEL_STATE: Readonly<Record<InterpretationModelState, InterpretedReadingState>> = {
  respondida: 'answered',
  ambigua: 'ambiguous',
  en_blanco: 'blank',
  ilegible: 'illegible',
};

export function toInterpretedReading(output: InterpretationOutput): InterpretedReading {
  return {
    literal: output.literal,
    state: STATE_BY_MODEL_STATE[output.estado],
    answer: output.respuesta,
    candidates: output.candidatos,
    confidence: output.confianza,
  };
}
