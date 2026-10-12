import type { PromptVariables, RenderedPrompt } from '@soe/types';
import { getPrompt } from '../prompts/registry';
import { renderPrompt } from '../prompts/render';
import { rubricGradeJsonSchema, type RubricGradeJsonSchema } from './rubric-grade-schema';

/** Nivel de la rúbrica tal como lo ve el calificador: sin puntaje absoluto ni datos del alumno. */
export interface RubricLevelForGrading {
  readonly code: string;
  readonly label?: string | null;
  readonly descriptor?: string | null;
  readonly creditFraction: number;
  readonly examples?: readonly string[];
}

export interface RubricGradingPromptInput {
  readonly promptRef: string;
  readonly levels: readonly RubricLevelForGrading[];
  readonly transcription: string;
  readonly stem?: string | null;
  readonly gradeName?: string | null;
}

export interface RenderedRubricGradingPrompt {
  readonly prompt: RenderedPrompt;
  readonly outputSchema: RubricGradeJsonSchema;
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)} %`;
}

/** Texto de la rúbrica: un bloque por nivel con su descriptor, su crédito y sus ejemplos. */
export function formatRubricLevels(levels: readonly RubricLevelForGrading[]): string {
  return levels
    .map((level) => {
      const label = level.label?.trim() ? ` (${level.label.trim()})` : '';
      const descriptor = level.descriptor?.trim() ? `: ${level.descriptor.trim()}` : '';
      const lines = [
        `- Nivel "${level.code}"${label}${descriptor}`,
        `  Crédito: ${percent(level.creditFraction)} del puntaje.`,
      ];
      const examples = (level.examples ?? []).map((example) => example.trim()).filter(Boolean);
      if (examples.length > 0) {
        lines.push('  Ejemplos de respuestas de este nivel:');
        for (const example of examples) lines.push(`  · ${example}`);
      }
      return lines.join('\n');
    })
    .join('\n');
}

/**
 * Renderiza un prompt de calificación con rúbrica. El esquema de salida restringe
 * `levelCode` a los códigos de la rúbrica; el hash cubre lo que realmente se envía.
 */
export function renderRubricGradingPrompt(
  input: RubricGradingPromptInput,
): RenderedRubricGradingPrompt {
  const prompt = getPrompt(input.promptRef);
  if (!prompt) throw new Error(`No existe el prompt ${input.promptRef}`);
  if (prompt.purpose !== 'rubric_grading') {
    throw new Error(`El prompt ${input.promptRef} no es de calificación con rúbrica`);
  }
  if (input.levels.length < 2) throw new Error('La rúbrica necesita al menos dos niveles');
  const candidates: PromptVariables = {
    rubricLevels: formatRubricLevels(input.levels),
    transcription: input.transcription,
    ...(input.stem?.trim() ? { stem: input.stem.trim() } : {}),
    ...(input.gradeName?.trim() ? { gradeName: input.gradeName.trim() } : {}),
  };
  const variables: PromptVariables = {};
  for (const name of prompt.variables) {
    const value = candidates[name];
    if (value) variables[name] = value;
  }
  const outputSchema = rubricGradeJsonSchema(input.levels.map((level) => level.code));
  return {
    prompt: renderPrompt(prompt, variables, outputSchema),
    outputSchema,
  };
}
