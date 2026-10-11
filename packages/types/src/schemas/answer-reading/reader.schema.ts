import { z } from 'zod';
import { responseFormatKindSchema } from './response-format.schema';

// Lectores y prompts versionados (diseño §6 y §7).

export const VISION_PROVIDERS = [
  'anthropic',
  'gemini',
  'openai',
  'vertex_gemini',
  'bedrock_anthropic',
] as const;
export type VisionProvider = (typeof VISION_PROVIDERS)[number];
export const visionProviderSchema = z.enum(VISION_PROVIDERS);

export const READER_HINTS = ['none', 'format'] as const;
export const READER_REASONING = ['off', 'low', 'medium'] as const;
export const MEDIA_RESOLUTIONS = ['low', 'medium', 'high'] as const;

export const PROMPT_REF_PATTERN = /^[a-z0-9.-]+@\d+$/;

// `family` agrupa modelos que se equivocan parecido (mismo proveedor y línea).
// La política de consenso puede exigir familias distintas (dos Gemini coinciden
// mucho pero se equivocan igual: medido en el experimento del 2026-10-11).
export const readerSpecSchema = z
  .object({
    key: z.string().min(1),
    transcriberId: z.string().min(1),
    provider: visionProviderSchema,
    family: z.string().min(1),
    model: z.string().min(1),
    promptRef: z.string().regex(PROMPT_REF_PATTERN),
    hints: z.enum(READER_HINTS),
    params: z
      .object({
        maxOutputTokens: z.number().int().positive(),
        reasoning: z.enum(READER_REASONING),
        mediaResolution: z.enum(MEDIA_RESOLUTIONS).optional(),
        timeoutMs: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export type ReaderSpec = z.infer<typeof readerSpecSchema>;

export const PROMPT_PURPOSES = ['transcription', 'rubric_grading'] as const;
export type PromptPurpose = (typeof PROMPT_PURPOSES)[number];

// Lista cerrada. NUNCA hay variables con datos del alumno, y un prompt de
// transcripción no puede declarar variables de clave o respuesta modelo.
export const PROMPT_VARIABLES = [
  'formatLabel',
  'formatGuide',
  'subjectName',
  'gradeName',
  'languageName',
  'stem',
  'unit',
  'partLabels',
  'rubricLevels',
  'transcription',
] as const;
export type PromptVariable = (typeof PROMPT_VARIABLES)[number];

export const TRANSCRIPTION_FORBIDDEN_VARIABLES: readonly PromptVariable[] = [
  'rubricLevels',
  'transcription',
];

export const PROMPT_STATUSES = ['draft', 'published', 'retired'] as const;

export const promptVersionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*$/),
    version: z.number().int().positive(),
    purpose: z.enum(PROMPT_PURPOSES),
    formatKinds: z.array(responseFormatKindSchema).min(1),
    outputSchemaId: z.string().min(1),
    variables: z.array(z.enum(PROMPT_VARIABLES)),
    system: z.string().min(1),
    user: z.string().min(1),
    status: z.enum(PROMPT_STATUSES),
  })
  .strict();
export type PromptVersion = z.infer<typeof promptVersionSchema>;

export const promptVariablesSchema = z.record(z.enum(PROMPT_VARIABLES), z.string());
export type PromptVariables = z.infer<typeof promptVariablesSchema>;

export const renderedPromptSchema = z.object({
  ref: z.string().regex(PROMPT_REF_PATTERN),
  hash: z.string().length(64),
  outputSchemaId: z.string().min(1),
  system: z.string(),
  user: z.string(),
});
export type RenderedPrompt = z.infer<typeof renderedPromptSchema>;
