import {
  promptVersionSchema,
  type PromptVariable,
  type PromptVariables,
  type PromptVersion,
  type ReaderSpec,
  type RenderedPrompt,
  type ResponseFormat,
} from '@soe/types';
import { formatLabelFor, promptGuideFor } from '../formats/registry';
import {
  baseTranscriptionJsonSchema,
  transcriptionJsonSchema,
  type TranscriptionJsonSchema,
} from '../formats/transcription-json-schema';
import { promptHash, promptRef, renderPrompt } from './render';
import { TRANSCRIBE_SHORT_ANSWER_V1, TRANSCRIBE_SHORT_ANSWER_V2 } from './transcribe-short-answer';

export const PROMPT_VERSIONS: readonly PromptVersion[] = [
  TRANSCRIBE_SHORT_ANSWER_V1,
  TRANSCRIBE_SHORT_ANSWER_V2,
].map((prompt) => promptVersionSchema.parse(prompt));

const BY_REF = new Map(PROMPT_VERSIONS.map((prompt) => [promptRef(prompt), prompt]));

export function getPrompt(ref: string): PromptVersion | null {
  return BY_REF.get(ref) ?? null;
}

/** Hash de la plantilla sin renderizar (lo que congela `prompts.lock.json`). */
export function templateHash(prompt: PromptVersion): string {
  return promptHash(
    prompt.system,
    prompt.user,
    prompt.outputSchemaId,
    baseTranscriptionJsonSchema().schema,
  );
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
