import type {
  CropProfileRef,
  ItemType,
  NormalizedAnswer,
  ReadBy,
  ResponseFormat,
  ResponseFormatKind,
  TranscriptionOutput,
} from '@soe/types';

/**
 * Formatos con definición en el registro. `bubble_choice` y `score_bubbles` se
 * leen por OMR (burbujas) y no pasan por la lectura por visión.
 */
export const SUPPORTED_FORMAT_KINDS = [
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
] as const satisfies readonly ResponseFormatKind[];
export type SupportedFormatKind = (typeof SUPPORTED_FORMAT_KINDS)[number];

export type FormatOf<K extends ResponseFormatKind> = Extract<ResponseFormat, { kind: K }>;

/** JSON Schema plano de las `parts` que se piden al lector (`null` = no se piden). */
export type PartsJsonSchema = {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, { type: 'string'; description: string }>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
};

/**
 * Definición de un formato de respuesta (diseño §5.4). Agregar un formato es una
 * entrada nueva en `ANSWER_FORMATS` más su test. La geometría de impresión
 * (`layout`) la agrega F5b.
 */
export interface AnswerFormatDefinition<K extends ResponseFormatKind> {
  readonly kind: K;
  readonly readBy: ReadBy;
  readonly compatibleItemTypes: readonly ItemType[];
  readonly defaultCropProfileId: CropProfileRef;
  /**
   * `key`: la corrige una estrategia contra la clave. `rubric`: solo se transcribe;
   * la califica una persona con la rúbrica, así que el consenso nunca la autoacepta.
   */
  readonly gradedBy: 'key' | 'rubric';
  /** Nombre del formato en español, para el prompt (`formatLabel`) y la UI. */
  formatLabel(format: FormatOf<K>): string;
  /** Guía de escritura para el prompt (`formatGuide`). No menciona la clave. */
  promptGuide(format: FormatOf<K>): string;
  /** Qué `parts` se piden al lector, o `null` si el formato no las usa. */
  outputPartsSchema(format: FormatOf<K>): PartsJsonSchema | null;
  /**
   * Interpreta la lectura con los parsers canónicos. Si el formato pide `parts` y
   * vienen completas y válidas, ellas son la fuente de verdad y el `literal` es
   * control (`literal_subset_of_parts` o `parts_disagree_with_literal`); si no,
   * se interpreta el `literal`. Un estado ≠ `answered` no tiene valor.
   */
  normalize(output: TranscriptionOutput, format: FormatOf<K>): NormalizedAnswer;
  /** Lo que recibe `getScoringStrategy(...).score` como `rawAnswer`. */
  toScoringInput(normalized: NormalizedAnswer): unknown;
}
