import { createHash } from 'node:crypto';
import {
  promptVersionSchema,
  type AnswerSpace,
  type PromptVariable,
  type PromptVariables,
  type PromptVersion,
  type ReaderSpec,
  type RenderedPrompt,
  type ResponseFormat,
  type ResponseFormatKind,
} from '@soe/types';
import { boxCellGuide } from '../formats/box-cells';
import { formatLabelFor, isSupportedFormatKind, promptGuideFor } from '../formats/registry';
import { DEFAULT_RESPONSE_GEOMETRY, type ResponseGeometry } from '../formats/response-geometry';
import {
  TRANSCRIPTION_BOX_CELLS_SCHEMA_ID,
  baseTranscriptionJsonSchema,
  transcriptionJsonSchema,
  transcriptionZodSchema,
  type TranscriptionJsonSchema,
} from '../formats/transcription-json-schema';
import { rubricGradeJsonSchema } from '../grading/rubric-grade-schema';
import { readingAuditJsonSchema } from '../audit/reading-audit-json-schema';
import { verificationJsonSchema } from '../verification/verification-json-schema';
import { readingAnswerKind } from '../interpretation/answer-kind';
import {
  interpretationJsonSchema,
  interpretationOutputSchema,
  type InterpretationJsonSchema,
} from '../interpretation/interpretation-output';
import { TRANSCRIBE_INTERPRET_V1 } from './transcribe-interpret';
import { AUDIT_READING_V1 } from './audit-reading';
import { GRADE_RUBRIC_V1 } from './grade-rubric';
import { promptHash, promptRef, renderPrompt } from './render';
import { TRANSCRIBE_BOXES_V1 } from './transcribe-boxes';
import { TRANSCRIBE_SHORT_ANSWER_V1, TRANSCRIBE_SHORT_ANSWER_V2 } from './transcribe-short-answer';
import {
  TRANSCRIBE_FREE_TEXT_V1,
  TRANSCRIBE_SHORT_TEXT_V1,
  TRANSCRIBE_SHORT_TEXT_V2,
} from './transcribe-text';
import { VERIFY_INCORRECT_V1 } from './verify-incorrect';

export const PROMPT_VERSIONS: readonly PromptVersion[] = [
  TRANSCRIBE_SHORT_ANSWER_V1,
  TRANSCRIBE_SHORT_ANSWER_V2,
  TRANSCRIBE_SHORT_TEXT_V1,
  TRANSCRIBE_SHORT_TEXT_V2,
  TRANSCRIBE_FREE_TEXT_V1,
  TRANSCRIBE_BOXES_V1,
  GRADE_RUBRIC_V1,
  VERIFY_INCORRECT_V1,
  AUDIT_READING_V1,
  TRANSCRIBE_INTERPRET_V1,
].map((prompt) => promptVersionSchema.parse(prompt));

const BY_REF = new Map(PROMPT_VERSIONS.map((prompt) => [promptRef(prompt), prompt]));

export function getPrompt(ref: string): PromptVersion | null {
  return BY_REF.get(ref) ?? null;
}

/** ¿El prompt transcribe el formato? Una ruta con otro prompt no puede leer esa casilla. */
export function isTranscriptionPromptFor(ref: string, kind: ResponseFormatKind): boolean {
  const prompt = getPrompt(ref);
  return prompt !== null && prompt.purpose === 'transcription' && prompt.formatKinds.includes(kind);
}

/** ¿El prompt lee por casilla? Lo decide la familia de esquema que declara. */
export function readsByBoxCell(prompt: Pick<PromptVersion, 'outputSchemaId'>): boolean {
  return prompt.outputSchemaId === TRANSCRIPTION_BOX_CELLS_SCHEMA_ID;
}

const TEMPLATE_OUTPUT_SCHEMAS: Record<
  PromptVersion['purpose'],
  (prompt: PromptVersion) => unknown
> = {
  transcription: (prompt) =>
    baseTranscriptionJsonSchema(
      readsByBoxCell(prompt) ? TRANSCRIPTION_BOX_CELLS_SCHEMA_ID : undefined,
    ).schema,
  rubric_grading: () => rubricGradeJsonSchema().schema,
  verification: () => verificationJsonSchema().schema,
  reading_audit: () => readingAuditJsonSchema().schema,
  interpretation: () => interpretationJsonSchema().schema,
};

/**
 * Hash de la plantilla sin renderizar (lo que congela `prompts.lock.json`), con el
 * esquema base de su propósito: transcripción, calificación con rúbrica o verificación.
 */
export function templateHash(prompt: PromptVersion): string {
  const outputSchema = TEMPLATE_OUTPUT_SCHEMAS[prompt.purpose](prompt);
  return promptHash(prompt.system, prompt.user, prompt.outputSchemaId, outputSchema);
}

/**
 * Formatos de muestra para el lock: cubren cada variante que cambia lo que se
 * envía al lector (número mixto, aridad, largo). Agregar una muestra exige
 * regenerar `prompts.lock.json`.
 */
export const PROMPT_LOCK_SAMPLE_FORMATS: readonly ResponseFormat[] = [
  { kind: 'integer', maxChars: 6, allowNegative: true },
  { kind: 'decimal', maxChars: 8, allowNegative: true },
  { kind: 'fraction', allowNegative: true, allowMixed: true },
  { kind: 'fraction', allowNegative: true, allowMixed: false },
  { kind: 'ordered_tuple', arity: 2, componentKind: 'integer' },
  { kind: 'ordered_tuple', arity: 3, componentKind: 'decimal' },
  { kind: 'sequence', length: 2 },
  { kind: 'sequence', length: 4 },
  { kind: 'word_list', count: 1 },
  { kind: 'word_list', count: 3 },
  { kind: 'short_text', maxWords: 8 },
  {
    kind: 'multi_box',
    boxes: [
      { partId: 'tens', label: 'Decenas', kind: 'integer' },
      { partId: 'units', label: 'Unidades', kind: 'integer' },
    ],
  },
  {
    kind: 'multi_box',
    boxes: [
      { partId: 'a', label: 'Primer sumando', kind: 'fraction' },
      { partId: 'b', label: 'Segundo sumando', kind: 'decimal' },
      { partId: 'word', label: 'Palabra', kind: 'short_text' },
    ],
  },
  { kind: 'free_text', lines: 6 },
  { kind: 'math_work', heightRatio: 0.4 },
];

/** Lo que el formato agrega a lo enviado: etiqueta, guía y esquema de salida (con `parts`). */
export interface FormatLockParts {
  readonly label: string;
  readonly guide: string;
  readonly outputSchemaId: string;
  readonly outputSchema: unknown;
}

export function formatLockParts(format: ResponseFormat): FormatLockParts {
  const output = transcriptionJsonSchema(format);
  return {
    label: formatLabelFor(format),
    guide: promptGuideFor(format),
    outputSchemaId: output.schemaId,
    outputSchema: output.schema,
  };
}

/** Lo mismo para un prompt que lee por casilla: la guía y el esquema dependen de la geometría. */
export function boxCellLockParts(
  format: ResponseFormat,
  geometry: ResponseGeometry,
): FormatLockParts {
  const output = transcriptionJsonSchema(format, geometry);
  return {
    label: formatLabelFor(format),
    guide: boxCellGuide(format, geometry),
    outputSchemaId: output.schemaId,
    outputSchema: output.schema,
  };
}

/** Geometrías de muestra del lock para la lectura por casilla (decimales de 1, 2 y 3 cifras). */
export const PROMPT_LOCK_SAMPLE_GEOMETRIES: readonly ResponseGeometry[] = [
  DEFAULT_RESPONSE_GEOMETRY,
  { fractionDigits: 1 },
  { fractionDigits: 3 },
];

function lockPartsFor(prompt: PromptVersion, format: ResponseFormat): FormatLockParts[] {
  if (!readsByBoxCell(prompt)) return [formatLockParts(format)];
  return PROMPT_LOCK_SAMPLE_GEOMETRIES.map((geometry) => boxCellLockParts(format, geometry));
}

/** Hash de un par prompt × formato: la plantilla más lo que aporta cada muestra del formato. */
export function promptFormatLockHash(
  prompt: PromptVersion,
  formats: readonly FormatLockParts[],
): string {
  return createHash('sha256')
    .update(JSON.stringify([templateHash(prompt), formats]), 'utf8')
    .digest('hex');
}

/** Lo que el formato agrega a un prompt de verificación: solo su etiqueta (nunca la guía). */
export function verificationFormatLockParts(format: ResponseFormat): FormatLockParts {
  const output = verificationJsonSchema();
  return {
    label: formatLabelFor(format),
    guide: '',
    outputSchemaId: output.schemaId,
    outputSchema: output.schema,
  };
}

/** Lo que el formato agrega a un prompt de auditoría de lectura: solo su etiqueta (nunca la guía). */
export function readingAuditFormatLockParts(format: ResponseFormat): FormatLockParts {
  const output = readingAuditJsonSchema();
  return {
    label: formatLabelFor(format),
    guide: '',
    outputSchemaId: output.schemaId,
    outputSchema: output.schema,
  };
}

/** Lo que el formato agrega a un prompt de interpretación: la descripción del tipo de respuesta. */
export function interpretationFormatLockParts(format: ResponseFormat): FormatLockParts {
  const output = interpretationJsonSchema();
  return {
    label: readingAnswerKind(format, null),
    guide: '',
    outputSchemaId: output.schemaId,
    outputSchema: output.schema,
  };
}

const FORMAT_LOCK_PARTS_BY_PURPOSE: Record<
  PromptVersion['purpose'],
  ((prompt: PromptVersion, format: ResponseFormat) => readonly FormatLockParts[]) | null
> = {
  transcription: (prompt, format) => lockPartsFor(prompt, format),
  rubric_grading: null,
  verification: (_prompt, format) => [verificationFormatLockParts(format)],
  reading_audit: (_prompt, format) => [readingAuditFormatLockParts(format)],
  interpretation: (_prompt, format) => [interpretationFormatLockParts(format)],
};

/**
 * Lo que congela `prompts.lock.json`: por cada versión publicada, el hash de la
 * plantilla y uno por cada formato que atiende. Cambiar la guía, la etiqueta o
 * las `parts` de un formato cambia el texto enviado y hace fallar el lock.
 */
export function promptLock(): Record<string, string> {
  const lock: Record<string, string> = {};
  for (const prompt of PROMPT_VERSIONS.filter((p) => p.status === 'published')) {
    const ref = promptRef(prompt);
    lock[ref] = templateHash(prompt);
    const partsOf = FORMAT_LOCK_PARTS_BY_PURPOSE[prompt.purpose];
    if (partsOf === null) continue;
    for (const kind of prompt.formatKinds.filter(isSupportedFormatKind)) {
      const samples = PROMPT_LOCK_SAMPLE_FORMATS.filter((format) => format.kind === kind);
      lock[`${ref} × ${kind}`] = promptFormatLockHash(
        prompt,
        samples.flatMap((format) => partsOf(prompt, format)),
      );
    }
  }
  return lock;
}

export interface TranscriptionPromptContext {
  readonly gradeName?: string | null;
  /** Geometría impresa de la casilla; solo la usan los prompts que leen por casilla. */
  readonly geometry?: ResponseGeometry | null;
}

function cellsGeometry(
  prompt: PromptVersion,
  context: TranscriptionPromptContext,
): ResponseGeometry | null {
  return readsByBoxCell(prompt) ? (context.geometry ?? DEFAULT_RESPONSE_GEOMETRY) : null;
}

/**
 * Variables de un prompt de transcripción. Solo contexto del ítem: nunca datos del
 * alumno ni la clave. Las pistas de formato van solo si la ruta las pide (`hints`).
 */
export function transcriptionVariables(
  prompt: PromptVersion,
  format: ResponseFormat,
  hints: ReaderSpec['hints'],
  context: TranscriptionPromptContext = {},
): PromptVariables {
  const cells = cellsGeometry(prompt, context);
  const candidates: Partial<Record<PromptVariable, string>> = {
    gradeName: context.gradeName ?? undefined,
    ...(hints === 'format'
      ? {
          formatLabel: formatLabelFor(format),
          formatGuide: cells === null ? promptGuideFor(format) : boxCellGuide(format, cells),
        }
      : {}),
  };
  const variables: PromptVariables = {};
  for (const name of prompt.variables) {
    const value = candidates[name];
    if (value) variables[name] = value;
  }
  return variables;
}

export interface RenderedTranscriptionPrompt {
  readonly prompt: RenderedPrompt;
  readonly outputSchema: TranscriptionJsonSchema;
  /** Validación de la salida con las mismas `parts` que pide `outputSchema`. */
  readonly outputZodSchema: ReturnType<typeof transcriptionZodSchema>;
}

export function renderTranscriptionPrompt(
  reader: Pick<ReaderSpec, 'promptRef' | 'hints'>,
  format: ResponseFormat,
  context: TranscriptionPromptContext = {},
): RenderedTranscriptionPrompt {
  const prompt = getPrompt(reader.promptRef);
  if (!prompt) throw new Error(`No existe el prompt ${reader.promptRef}`);
  if (prompt.purpose !== 'transcription' || !prompt.formatKinds.includes(format.kind)) {
    throw new Error(`El prompt ${reader.promptRef} no sirve para el formato ${format.kind}`);
  }
  const cells = cellsGeometry(prompt, context);
  const outputSchema = transcriptionJsonSchema(format, cells);
  return {
    prompt: renderPrompt(
      prompt,
      transcriptionVariables(prompt, format, reader.hints, context),
      outputSchema,
    ),
    outputSchema,
    outputZodSchema: transcriptionZodSchema(format, cells),
  };
}

/** ¿El prompt interpreta el formato? Solo un prompt de interpretación sirve al modo `interpreted`. */
export function isInterpretationPromptFor(ref: string, kind: ResponseFormatKind): boolean {
  const prompt = getPrompt(ref);
  return (
    prompt !== null && prompt.purpose === 'interpretation' && prompt.formatKinds.includes(kind)
  );
}

export interface InterpretationPromptContext {
  readonly gradeName?: string | null;
  /** Espacio de respuestas del ítem (opciones, nunca la clave). */
  readonly space?: AnswerSpace | null;
}

export interface RenderedInterpretationPrompt {
  readonly prompt: RenderedPrompt;
  readonly outputSchema: InterpretationJsonSchema;
  readonly outputZodSchema: typeof interpretationOutputSchema;
}

export function renderInterpretationPrompt(
  reader: Pick<ReaderSpec, 'promptRef'>,
  format: ResponseFormat,
  context: InterpretationPromptContext = {},
): RenderedInterpretationPrompt {
  const prompt = getPrompt(reader.promptRef);
  if (!prompt) throw new Error(`No existe el prompt ${reader.promptRef}`);
  if (prompt.purpose !== 'interpretation' || !prompt.formatKinds.includes(format.kind)) {
    throw new Error(`El prompt ${reader.promptRef} no interpreta el formato ${format.kind}`);
  }
  const outputSchema = interpretationJsonSchema();
  const variables: PromptVariables = {
    answerKind: readingAnswerKind(format, context.space ?? null),
  };
  if (context.gradeName) variables.gradeName = context.gradeName;
  return {
    prompt: renderPrompt(prompt, variables, outputSchema),
    outputSchema,
    outputZodSchema: interpretationOutputSchema,
  };
}
