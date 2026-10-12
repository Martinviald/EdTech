import { createHash } from 'node:crypto';
import {
  PROMPT_VARIABLES,
  type PromptVariable,
  type PromptVariables,
  type PromptVersion,
  type RenderedPrompt,
} from '@soe/types';

const SECTION = /\{\{#([a-zA-Z]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
const VARIABLE = /\{\{([a-zA-Z]+)\}\}/g;
const TEMPLATE_TOKEN = /\{\{[#/]?([a-zA-Z]+)\}\}/g;

export function promptRef(prompt: Pick<PromptVersion, 'id' | 'version'>): string {
  return `${prompt.id}@${prompt.version}`;
}

/** Variables que usa una plantilla (en `{{x}}` o en secciones `{{#x}}…{{/x}}`). */
export function templateVariables(template: string): string[] {
  return [...new Set([...template.matchAll(TEMPLATE_TOKEN)].map((match) => match[1] ?? ''))];
}

function isPromptVariable(name: string): name is PromptVariable {
  return (PROMPT_VARIABLES as readonly string[]).includes(name);
}

/**
 * Sustitución sin lógica: `{{x}}` se reemplaza por el valor (vacío si falta) y
 * `{{#x}}…{{/x}}` se incluye solo si `x` tiene valor.
 */
export function renderTemplate(template: string, variables: PromptVariables): string {
  const valueOf = (name: string) => (isPromptVariable(name) ? (variables[name] ?? '') : '');
  return template
    .replace(SECTION, (_section, name: string, body: string) =>
      valueOf(name).trim().length > 0 ? body : '',
    )
    .replace(VARIABLE, (_token, name: string) => valueOf(name))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** `sha256(system + user + outputSchemaId + JSON del esquema de salida)` (diseño §6.2). */
export function promptHash(
  system: string,
  user: string,
  outputSchemaId: string,
  outputSchema: unknown,
): string {
  return sha256(`${system}${user}${outputSchemaId}${JSON.stringify(outputSchema)}`);
}

/**
 * Renderiza una versión de prompt. Rechaza variables no declaradas por la versión:
 * así ninguna ruta puede colar datos que el prompt no pidió (y nunca la clave).
 */
export function renderPrompt(
  prompt: PromptVersion,
  variables: PromptVariables,
  output: { schemaId: string; schema: unknown },
): RenderedPrompt {
  const undeclared = Object.keys(variables).filter(
    (name) => !(prompt.variables as readonly string[]).includes(name),
  );
  if (undeclared.length > 0) {
    throw new Error(`Variables no declaradas en ${promptRef(prompt)}: ${undeclared.join(', ')}`);
  }
  const system = renderTemplate(prompt.system, variables);
  const user = renderTemplate(prompt.user, variables);
  return {
    ref: promptRef(prompt),
    hash: promptHash(system, user, output.schemaId, output.schema),
    outputSchemaId: output.schemaId,
    system,
    user,
  };
}
