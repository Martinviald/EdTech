import { createHash } from 'node:crypto';
import {
  promptVersionSchema,
  type PromptVariable,
  type PromptVariables,
  type PromptVersion,
  type ReaderSpec,
  type RenderedPrompt,
  type ResponseFormat,
  type ResponseFormatKind,
} from '@soe/types';
import { formatLabelFor, isSupportedFormatKind, promptGuideFor } from '../formats/registry';
import {
  baseTranscriptionJsonSchema,
  transcriptionJsonSchema,
  type TranscriptionJsonSchema,
} from '../formats/transcription-json-schema';
import { rubricGradeJsonSchema } from '../grading/rubric-grade-schema';
import { GRADE_RUBRIC_V1 } from './grade-rubric';
import { promptHash, promptRef, renderPrompt } from './render';
import { TRANSCRIBE_SHORT_ANSWER_V1, TRANSCRIBE_SHORT_ANSWER_V2 } from './transcribe-short-answer';
import { TRANSCRIBE_FREE_TEXT_V1, TRANSCRIBE_SHORT_TEXT_V1 } from './transcribe-text';

export const PROMPT_VERSIONS: readonly PromptVersion[] = [
  TRANSCRIBE_SHORT_ANSWER_V1,
  TRANSCRIBE_SHORT_ANSWER_V2,
  TRANSCRIBE_SHORT_TEXT_V1,
  TRANSCRIBE_FREE_TEXT_V1,
  GRADE_RUBRIC_V1,
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

/**
 * Hash de la plantilla sin renderizar (lo que congela `prompts.lock.json`), con el
 * esquema base de su propósito: transcripción o calificación con rúbrica.
 */
export function templateHash(prompt: PromptVersion): string {
  const outputSchema =
    prompt.purpose === 'rubric_grading'
      ? rubricGradeJsonSchema().schema
      : baseTranscriptionJsonSchema().schema;
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

/** Hash de un par prompt × formato: la plantilla más lo que aporta cada muestra del formato. */
export function promptFormatLockHash(
  prompt: PromptVersion,
  formats: readonly FormatLockParts[],
): string {
  return createHash('sha256')
    .update(JSON.stringify([templateHash(prompt), formats]), 'utf8')
    .digest('hex');
}

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
    if (prompt.purpose !== 'transcription') continue;
    for (const kind of prompt.formatKinds.filter(isSupportedFormatKind)) {
      const samples = PROMPT_LOCK_SAMPLE_FORMATS.filter((format) => format.kind === kind);
      lock[`${ref} × ${kind}`] = promptFormatLockHash(prompt, samples.map(formatLockParts));
    }
  }
  return lock;
}

export interface TranscriptionPromptContext {
  readonly gradeName?: string | null;
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
  const candidates: Partial<Record<PromptVariable, string>> = {
    gradeName: context.gradeName ?? undefined,
    ...(hints === 'format'
      ? { formatLabel: formatLabelFor(format), formatGuide: promptGuideFor(format) }
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
  const outputSchema = transcriptionJsonSchema(format);
  return {
    prompt: renderPrompt(
      prompt,
      transcriptionVariables(prompt, format, reader.hints, context),
      outputSchema,
    ),
    outputSchema,
  };
}
