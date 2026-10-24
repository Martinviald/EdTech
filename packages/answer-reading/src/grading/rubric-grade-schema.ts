import { z } from 'zod';

// Salida de la calificación asistida con rúbrica (diseño §4 S8). El orden de las
// propiedades pide primero la evidencia y la justificación, y después el nivel:
// el modelo razona antes de decidir.

export const RUBRIC_GRADE_SCHEMA_VERSION = 1;

/** Familia de esquemas de salida que declaran los prompts de calificación con rúbrica. */
export const RUBRIC_GRADE_OUTPUT_SCHEMA_ID = `rubric-grade-output@${RUBRIC_GRADE_SCHEMA_VERSION}`;

export const RUBRIC_GRADE_OUTPUT_KEYS = [
  'evidenceQuotes',
  'rationale',
  'levelCode',
  'confidence',
] as const;
export type RubricGradeOutputKey = (typeof RUBRIC_GRADE_OUTPUT_KEYS)[number];

export const MAX_EVIDENCE_QUOTES = 3;

export const rubricGradeOutputSchema = z.object({
  evidenceQuotes: z.array(z.string()).transform((quotes) => quotes.slice(0, MAX_EVIDENCE_QUOTES)),
  rationale: z.string().min(1),
  levelCode: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type RubricGradeOutput = z.infer<typeof rubricGradeOutputSchema>;

type JsonSchema = { readonly [key: string]: unknown };

export interface RubricGradeJsonSchema {
  readonly schemaId: string;
  readonly schema: {
    readonly type: 'object';
    readonly properties: Readonly<Record<RubricGradeOutputKey, JsonSchema>>;
    readonly required: readonly RubricGradeOutputKey[];
    readonly additionalProperties: false;
  };
  readonly propertyOrder: readonly RubricGradeOutputKey[];
}

/**
 * JSON Schema de la salida. Con `levelCodes`, `levelCode` queda restringido a los
 * códigos de la rúbrica del ítem; sin ellos (el lock de prompts) es texto libre.
 */
export function rubricGradeJsonSchema(levelCodes?: readonly string[]): RubricGradeJsonSchema {
  const levelCode: JsonSchema =
    levelCodes === undefined
      ? { type: 'string', description: 'Código exacto de un nivel de la rúbrica' }
      : {
          type: 'string',
          enum: [...levelCodes],
          description: 'Código exacto de un nivel de la rúbrica',
        };
  const properties: Record<RubricGradeOutputKey, JsonSchema> = {
    evidenceQuotes: {
      type: 'array',
      items: { type: 'string' },
      description: `Hasta ${MAX_EVIDENCE_QUOTES} fragmentos textuales de la transcripción`,
    },
    rationale: { type: 'string', description: 'Una o dos frases en español' },
    levelCode,
    confidence: {
      type: 'number',
      description: 'Probabilidad entre 0 y 1 de que un docente asigne el mismo nivel',
    },
  };
  const order = [...RUBRIC_GRADE_OUTPUT_KEYS];
  return {
    schemaId: RUBRIC_GRADE_OUTPUT_SCHEMA_ID,
    schema: {
      type: 'object',
      properties,
      required: order,
      additionalProperties: false,
    },
    propertyOrder: order,
  };
}
